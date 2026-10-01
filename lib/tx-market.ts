// Transaction-scoped market/account helpers — shared by lib/actions.ts and
// ops scripts (scripts/reset-economy.ts) so a one-shot DB job runs the exact
// same code path as the live server. No next/* imports: keep it scriptable.
import { db, schema } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { yesPrice, multiCoords, multiPrices } from "@/lib/lmsr";
import { liquidationValueCents, groupLiquidationValueCents, shouldLiquidate } from "@/lib/liq";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function toNum(s: string | number): number {
  return typeof s === "number" ? s : Number(s);
}

export async function credit(
  tx: Tx,
  userId: string,
  amountCents: number,
  kind: string,
  marketId: string | null,
  memo: string
) {
  const amt = Math.round(amountCents);
  // bigint columns can hold anything sane; this guards JS number precision
  // and turns nonsense deltas into a clean error instead of a DB failure.
  if (!Number.isSafeInteger(amt)) throw new Error("Amount too large");
  const [u] = await tx
    .update(schema.user)
    .set({ balanceCents: sql`${schema.user.balanceCents} + ${amt}` })
    .where(eq(schema.user.id, userId))
    .returning({ balanceCents: schema.user.balanceCents });
  if (!u) throw new Error("User not found");
  if (u.balanceCents < 0) throw new Error("Insufficient balance");
  await tx.insert(schema.ledger).values({
    userId,
    amountCents: amt,
    balanceAfterCents: u.balanceCents,
    kind,
    marketId,
    memo,
  });
  return u.balanceCents;
}

export async function lockMarket(tx: Tx, marketId: string) {
  const rows = await tx
    .select()
    .from(schema.market)
    .where(eq(schema.market.id, marketId))
    .for("update")
    .limit(1);
  const m = rows[0];
  if (!m) throw new Error("Market not found");
  return m;
}

export async function lockUser(tx: Tx, userId: string) {
  const rows = await tx
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .for("update")
    .limit(1);
  if (!rows[0]) throw new Error("User not found");
  return rows[0];
}

// Sweep a binary market: any leveraged position whose liquidation value can
// no longer cover its loan is force-sold at the current book; the proceeds
// service the debt first, the remainder (if any) credits the user. Iterates
// to a fixpoint — a liquidation late in the scan can push an earlier-passed
// position under the cushion, so loop until a pass frees nothing.
export async function checkLiquidations(tx: Tx, marketId: string) {
  const m = await lockMarket(tx, marketId);
  let qy = toNum(m.qYes);
  let qn = toNum(m.qNo);
  let touched = false;
  for (;;) {
    const rows = await tx
      .select()
      .from(schema.position)
      .where(and(eq(schema.position.marketId, marketId), sql`${schema.position.debtCents} > 0`))
      .for("update");
    let passTouched = false;
    for (const p of rows) {
      const y = toNum(p.yesShares);
      const n = toNum(p.noShares);
      const valueCents = liquidationValueCents(qy, qn, m.b, y, n);
      if (!shouldLiquidate(valueCents, p.debtCents, m.maxLeverage)) continue;
      qy -= y;
      qn -= n;
      const equity = Math.max(0, valueCents - p.debtCents);
      await lockUser(tx, p.userId);
      if (equity > 0) {
        await credit(tx, p.userId, equity, "liq", marketId, `Liquidated: ${m.question.slice(0, 60)}`);
      } else {
        // A wipeout is silent without a row — tell them the position died.
        const [w] = await tx.select({ balanceCents: schema.user.balanceCents }).from(schema.user).where(eq(schema.user.id, p.userId)).limit(1);
        await tx.insert(schema.ledger).values({
          userId: p.userId,
          amountCents: 0,
          balanceAfterCents: w?.balanceCents ?? 0,
          kind: "liq",
          marketId,
          memo: `Liquidated (total loss): ${m.question.slice(0, 60)}`,
        });
      }
      await tx
        .delete(schema.position)
        .where(and(eq(schema.position.marketId, marketId), eq(schema.position.userId, p.userId)));
      passTouched = true;
      touched = true;
    }
    if (!passTouched) break;
  }
  if (touched) {
    await tx.update(schema.market).set({ qYes: String(qy), qNo: String(qn) }).where(eq(schema.market.id, marketId));
    await tx.insert(schema.pricePoint).values({ marketId, yesPrice: yesPrice(qy, qn, m.b).toFixed(5) });
  }
}

// Same sweep for a group book: one option's trade moves every sibling's
// price, so the whole family's leveraged positions get checked. `book` is
// the locked live siblings with post-trade coordinates — a liquidation sells
// the position back: YES shares come off that option's coordinate, NO shares
// (the complement bundle) come off every sibling's via the shared math.
export async function checkGroupLiquidations(
  tx: Tx,
  book: { m: typeof schema.market.$inferSelect; qYes: number; qNo: number; dirty: boolean }[]
) {
  const b = book[0]?.m.b ?? 300;
  let touched = false;
  for (;;) {
    let passTouched = false;
    for (let i = 0; i < book.length; i++) {
      const { m } = book[i];
      const rows = await tx
        .select()
        .from(schema.position)
        .where(and(eq(schema.position.marketId, m.id), sql`${schema.position.debtCents} > 0`))
        .for("update");
      for (const p of rows) {
        const y = toNum(p.yesShares);
        const n = toNum(p.noShares);
        const coords = multiCoords(book);
        const valueCents = groupLiquidationValueCents(coords, b, i, y, n);
        if (!shouldLiquidate(valueCents, p.debtCents, m.maxLeverage)) continue;
        book[i].qYes -= y;
        book[i].qNo -= n;
        book[i].dirty = true;
        const equity = Math.max(0, valueCents - p.debtCents);
        await lockUser(tx, p.userId);
        if (equity > 0) {
          await credit(tx, p.userId, equity, "liq", m.id, `Liquidated: ${m.question.slice(0, 60)}`);
        } else {
          // A wipeout is silent without a row — tell them the position died.
          const [w] = await tx.select({ balanceCents: schema.user.balanceCents }).from(schema.user).where(eq(schema.user.id, p.userId)).limit(1);
          await tx.insert(schema.ledger).values({
            userId: p.userId,
            amountCents: 0,
            balanceAfterCents: w?.balanceCents ?? 0,
            kind: "liq",
            marketId: m.id,
            memo: `Liquidated (total loss): ${m.question.slice(0, 60)}`,
          });
        }
        await tx
          .delete(schema.position)
          .where(and(eq(schema.position.marketId, m.id), eq(schema.position.userId, p.userId)));
        passTouched = true;
        touched = true;
      }
    }
    if (!passTouched) break;
  }
  if (touched) {
    // Liquidations reprice the whole book — persist every moved coordinate
    // and give each sibling a fresh point so the lines stay consistent.
    const prices = multiPrices(multiCoords(book), b);
    for (const [i, s] of book.entries()) {
      if (s.dirty) {
        await tx
          .update(schema.market)
          .set({ qYes: s.qYes.toFixed(6), qNo: s.qNo.toFixed(6) })
          .where(eq(schema.market.id, s.m.id));
      }
      await tx.insert(schema.pricePoint).values({ marketId: s.m.id, yesPrice: prices[i].toFixed(5) });
    }
  }
}
