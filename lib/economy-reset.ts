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
): Promise<{ unwound: number; clamped: number }> {
  let unwound = 0;
  let clamped = 0;

  // ---- Phase 1: oversized positions ----
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
      if (valueCents <= WHALE_CAP_CENTS) continue; // sane size — keep it
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
    clamped++;
  }

  return { unwound, clamped };
}
