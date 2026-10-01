// The whale fix, as one transaction — shared by the admin action
// (adminResetEconomy) and scripts/reset-economy.ts so a manual run is the
// identical code path, not a copy that can drift.
//  1. Any live-market position worth more than WHALE_CAP_CENTS at current
//     prices is force-unwound: its shares come off the book honestly (LMSR
//     cost deltas), the position's loan eats the proceeds first, and the
//     remainder credits the user. Bets that size are exploit proceeds, not
//     conviction — positions under the cap ("those that make sense") stay.
//  2. Every non-admin balance above the cap is clamped just under Ɱ5 000;
//     the difference is ledgered as an admin debit so the ledger still sums.
//  3. Flagged churners (unwound, clamped, or lifetime turnover > 5× cap) have
//     ALL their positions unwound — an honest liquidation at book prices —
//     then their trade rows are purged and market stats recount.
import { schema } from "@/lib/db";
import { eq, and, sql, asc, inArray } from "drizzle-orm";
import { yesPrice, tradeCost, multiCoords, multiPrices, multiTradeCost } from "@/lib/lmsr";
import { liquidationValueCents, groupLiquidationValueCents } from "@/lib/liq";
import { toNum, credit, lockUser, checkLiquidations, checkGroupLiquidations, type Tx } from "@/lib/tx-market";

export const WHALE_CAP_CENTS = 500_000; // Ɱ5 000
export const WHALE_BALANCE_CENTS = 499_900; // Ɱ4 999,00 — lands under the cap

export async function resetEconomyTx(
  tx: Tx,
  { exemptEmail }: { exemptEmail?: string } = {}
): Promise<{ unwound: number; clamped: number; purgedTrades: number; recounted: number }> {
  let unwound = 0;
  let clamped = 0;
  // Users the reset touched — their trade rows are purged in phase 3.
  const flagged = new Set<string>();

  // ---- Phase 0: flag churners BEFORE unwinding ----
  // Flagging must precede phase 1 so a churner's positions unwind even when
  // each sits under the cap — lifetime turnover > 5× cap marks a whale.
  const protectedRows = await tx
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(
      exemptEmail
        ? sql`${schema.user.role} = 'admin' OR lower(${schema.user.email}) = ${exemptEmail.toLowerCase()}`
        : sql`${schema.user.role} = 'admin'`
    );
  const protectedIds = new Set(protectedRows.map((u) => u.id));
  // Lifetime turnover comes from the ledger — trade rows get purged, ledger
  // never does, so a churner can't reset their flag by being reset once.
  const churn = await tx
    .select({ userId: schema.ledger.userId, total: sql<string>`sum(abs(${schema.ledger.amountCents}))` })
    .from(schema.ledger)
    .where(inArray(schema.ledger.kind, ["buy", "sell"]))
    .groupBy(schema.ledger.userId);
  for (const t of churn) if (Number(t.total) > WHALE_CAP_CENTS * 5 && !protectedIds.has(t.userId)) flagged.add(t.userId);

  // ---- Phase 1: oversized positions, plus every position a churner holds ----
  const posRows = await tx.select().from(schema.position).orderBy(asc(schema.position.marketId));
  const byId = new Map(
    (posRows.length
      ? await tx.select().from(schema.market).where(inArray(schema.market.id, [...new Set(posRows.map((p) => p.marketId))]))
      : []
    ).map((m) => [m.id, m])
  );
  // Book = shared price book: a binary market is its own book, a group
  // option shares the parent book with ALL its live siblings — every
  // coordinate feeds the shared softmax, so a partial read misprices.
  const books = new Map<string, string | null>(); // bookKey → parentId (null = binary)
  for (const p of posRows) {
    const m = byId.get(p.marketId);
    if (!m || m.status !== "live") continue;
    books.set(m.parentId ?? m.id, m.parentId);
  }
  for (const [key, parentId] of books) {
    // Lock the whole book in id order — same discipline as placeTrade.
    const live = await tx
      .select()
      .from(schema.market)
      .where(parentId ? and(eq(schema.market.parentId, parentId), eq(schema.market.status, "live")) : eq(schema.market.id, key))
      .orderBy(asc(schema.market.id))
      .for("update");
    const book = live.map((s) => ({ m: s, qYes: toNum(s.qYes), qNo: toNum(s.qNo), dirty: false }));
    const isGroup = live.some((s) => s.parentId);
    const positions = await tx
      .select()
      .from(schema.position)
      .where(inArray(schema.position.marketId, live.map((s) => s.id)))
      .for("update");
    const volumeBy = new Map<string, number>();
    for (const p of positions) {
      const k = live.findIndex((s) => s.id === p.marketId);
      if (k < 0) continue;
      const mm = live[k];
      const b = mm.b;
      const y = toNum(p.yesShares);
      const n = toNum(p.noShares);
      if (y <= 0 && n <= 0) continue;
      const valueCents = isGroup
        ? groupLiquidationValueCents(multiCoords(book), b, k, y, n)
        : liquidationValueCents(book[k].qYes, book[k].qNo, b, y, n);
      if (valueCents <= WHALE_CAP_CENTS && !flagged.has(p.userId)) continue; // sane size, unflagged — keep it
      // Sell both sides at current prices; loan eats the proceeds first.
      let grossCents = 0;
      for (const [outcome, held] of [["yes", y], ["no", n]] as const) {
        if (held <= 0) continue;
        const proceeds = Math.round(
          -(isGroup
            ? multiTradeCost(multiCoords(book), b, k, outcome, -held)
            : tradeCost(book[k].qYes, book[k].qNo, b, outcome, -held)) * 100
        );
        if (outcome === "yes") book[k].qYes -= held;
        else book[k].qNo -= held;
        grossCents += Math.max(0, proceeds);
        volumeBy.set(mm.id, (volumeBy.get(mm.id) ?? 0) + Math.max(0, proceeds));
        await tx.insert(schema.trade).values({
          marketId: mm.id,
          userId: p.userId,
          side: "sell",
          outcome,
          shares: String(held),
          amountCents: Math.max(0, proceeds),
          yesPriceAfter: (isGroup ? multiPrices(multiCoords(book), b)[k] : yesPrice(book[k].qYes, book[k].qNo, b)).toFixed(5),
        });
      }
      book[k].dirty = true;
      const equity = Math.max(0, grossCents - p.debtCents);
      await lockUser(tx, p.userId);
      await credit(tx, p.userId, equity, "liq", mm.id, `Position reset: ${mm.question.slice(0, 60)}`);
      await tx
        .delete(schema.position)
        .where(and(eq(schema.position.marketId, p.marketId), eq(schema.position.userId, p.userId)));
      flagged.add(p.userId);
      unwound++;
    }
    const prices = isGroup ? multiPrices(multiCoords(book), book[0]?.m.b ?? 300) : null;
    for (const [i, s] of book.entries()) {
      if (s.dirty) {
        await tx
          .update(schema.market)
          .set({
            qYes: String(s.qYes),
            qNo: String(s.qNo),
            volumeCents: sql`${schema.market.volumeCents} + ${volumeBy.get(s.m.id) ?? 0}`,
          })
          .where(eq(schema.market.id, s.m.id));
      }
      if (s.dirty || isGroup) {
        await tx.insert(schema.pricePoint).values({
          marketId: s.m.id,
          yesPrice: (prices ? prices[i] : yesPrice(s.qYes, s.qNo, s.m.b)).toFixed(5),
        });
      }
    }
    // The unwind moved prices — flush leveraged positions that no longer
    // cover their loan, same as any big sell does.
    if (isGroup) await checkGroupLiquidations(tx, book);
    else for (const s of book) await checkLiquidations(tx, s.m.id);
  }

  // ---- Phase 2: balance clamp ----
  const whales = await tx
    .select({ id: schema.user.id, balanceCents: schema.user.balanceCents, role: schema.user.role, email: schema.user.email })
    .from(schema.user)
    .where(sql`${schema.user.balanceCents} > ${WHALE_CAP_CENTS}`)
    .for("update");
  for (const w of whales) {
    if (w.role === "admin" || (w.email ?? "").toLowerCase() === (exemptEmail ?? "").toLowerCase()) continue;
    const cut = w.balanceCents - WHALE_BALANCE_CENTS;
    await tx.update(schema.user).set({ balanceCents: WHALE_BALANCE_CENTS }).where(eq(schema.user.id, w.id));
    await tx.insert(schema.ledger).values({
      userId: w.id,
      amountCents: -cut,
      balanceAfterCents: WHALE_BALANCE_CENTS,
      kind: "admin",
      marketId: null,
      memo: "Balance reset to Ɱ 4 999",
    });
    flagged.add(w.id);
    clamped++;
  }

  // ---- Phase 3: purge churn trades, recount market stats ----
  // Leveraged round-trips left displayed volume/trader counts wildly inflated.
  // Trade rows are display history — the ledger keeps the money audit — so a
  // flagged user's bets are erased, then every market's stats recount from
  // surviving trades: volume = house seed + real turnover, traders = distinct
  // users. Flagging also catches anyone who churned more than 5× the cap over
  // their lifetime — honest small accounts can't reach that.
  for (const id of protectedIds) flagged.delete(id);

  const purgedTrades = flagged.size
    ? (await tx.delete(schema.trade).where(inArray(schema.trade.userId, [...flagged])).returning({ id: schema.trade.id })).length
    : 0;

  const markets = await tx
    .select({ id: schema.market.id, seedCents: schema.market.seedCents, volumeCents: schema.market.volumeCents, traderCount: schema.market.traderCount })
    .from(schema.market);
  const aggs = await tx
    .select({
      marketId: schema.trade.marketId,
      vol: sql<string>`coalesce(sum(${schema.trade.amountCents}), 0)`,
      tc: sql<number>`count(distinct ${schema.trade.userId})::int`,
    })
    .from(schema.trade)
    .groupBy(schema.trade.marketId);
  const byMarket = new Map(aggs.map((a) => [a.marketId, a]));
  let recounted = 0;
  for (const m of markets) {
    const a = byMarket.get(m.id);
    // Stored seed, not the formula — the baseline recorded at creation is
    // what the displayed volume always included.
    const volumeCents = m.seedCents + Number(a?.vol ?? 0);
    const traderCount = a?.tc ?? 0;
    if (volumeCents !== m.volumeCents || traderCount !== m.traderCount) {
      await tx.update(schema.market).set({ volumeCents, traderCount }).where(eq(schema.market.id, m.id));
      recounted++;
    }
  }

  // New stats epoch — bank PnL and balance charts restart from here.
  await tx
    .insert(schema.casinoConfig)
    .values({ id: "house", statsSince: new Date() })
    .onConflictDoUpdate({ target: schema.casinoConfig.id, set: { statsSince: new Date() } });

  return { unwound, clamped, purgedTrades, recounted };
}
