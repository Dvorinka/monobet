"use server";

import { db, schema } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireUser, requireAdmin } from "@/lib/session";
import { yesPrice, tradeCost, sharesForSpend } from "@/lib/lmsr";
import { marketYesPrice } from "@/lib/queries";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const CLAIM_AMOUNT = 25_000; // Ɱ250.00
const CLAIM_COOLDOWN_MS = 20 * 3600 * 1000;

// ---------- helpers ----------

async function credit(
  tx: Tx,
  userId: string,
  amountCents: number,
  kind: string,
  marketId: string | null,
  memo: string
) {
  const [u] = await tx
    .update(schema.user)
    .set({ balanceCents: sql`${schema.user.balanceCents} + ${Math.round(amountCents)}` })
    .where(eq(schema.user.id, userId))
    .returning({ balanceCents: schema.user.balanceCents });
  if (!u) throw new Error("User not found");
  if (u.balanceCents < 0) throw new Error("Insufficient balance");
  await tx.insert(schema.ledger).values({
    userId,
    amountCents: Math.round(amountCents),
    balanceAfterCents: u.balanceCents,
    kind,
    marketId,
    memo,
  });
  return u.balanceCents;
}

async function lockMarket(tx: Tx, marketId: string) {
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

async function lockUser(tx: Tx, userId: string) {
  const rows = await tx
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .for("update")
    .limit(1);
  if (!rows[0]) throw new Error("User not found");
  return rows[0];
}

function slugify(q: string): string {
  const base = q
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

function toNum(s: string | number): number {
  return typeof s === "number" ? s : Number(s);
}

// ---------- trading ----------

export async function placeTrade(input: {
  marketId: string;
  outcome: "yes" | "no";
  side: "buy" | "sell";
  spendCents?: number;
  shares?: number;
}): Promise<{ ok: true; shares: number; costCents: number; price: number } | { ok: false; error: string }> {
  try {
    const u = await requireUser();
    const { marketId, outcome, side } = input;
    if (outcome !== "yes" && outcome !== "no") throw new Error("Bad outcome");

    let result!: { shares: number; costCents: number; price: number };

    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, marketId);
      if (m.status !== "live") throw new Error("Market is not live");
      if (m.closesAt && new Date(m.closesAt) < new Date()) throw new Error("Market is closed");
      await lockUser(tx, u.id);

      const qYes = toNum(m.qYes);
      const qNo = toNum(m.qNo);
      const b = m.b;

      let shares: number;
      let cashDelta: number; // negative = pay, positive = receive

      if (side === "buy") {
        const spend = Math.round(input.spendCents ?? 0);
        if (!Number.isFinite(spend) || spend < 100) throw new Error("Minimum trade is Ɱ1");
        shares = sharesForSpend(qYes, qNo, b, outcome, spend / 100);
        if (shares <= 0) throw new Error("Trade too small");
        cashDelta = -spend;
      } else {
        shares = -Math.abs(input.shares ?? 0); // negative = removing shares from market
        if (!Number.isFinite(shares) || shares >= 0) throw new Error("Enter shares to sell");
        const [pos] = await tx
          .select()
          .from(schema.position)
          .where(and(eq(schema.position.marketId, marketId), eq(schema.position.userId, u.id)))
          .limit(1);
        const held = toNum(outcome === "yes" ? pos?.yesShares ?? "0" : pos?.noShares ?? "0");
        if (held + 1e-6 < -shares) throw new Error("Not enough shares");
        const refund = tradeCost(qYes, qNo, b, outcome, shares);
        cashDelta = Math.round(refund * 100); // nearest cent
        if (cashDelta <= 0) throw new Error("Nothing to refund");
      }

      const shareDelta = shares;
      const absShares = Math.abs(shareDelta);
      const newQYes = outcome === "yes" ? qYes + shareDelta : qYes;
      const newQNo = outcome === "no" ? qNo + shareDelta : qNo;
      const newPrice = yesPrice(newQYes, newQNo, b);

      await credit(
        tx,
        u.id,
        cashDelta,
        side === "buy" ? "buy" : "sell",
        marketId,
        `${side === "buy" ? "Bought" : "Sold"} ${absShares.toFixed(2)} ${outcome.toUpperCase()} @ ${(outcome === "yes" ? newPrice : 1 - newPrice).toFixed(2)}`
      );

      // upsert position
      await tx
        .insert(schema.position)
        .values({
          marketId,
          userId: u.id,
          yesShares: outcome === "yes" ? String(shareDelta) : "0",
          noShares: outcome === "no" ? String(shareDelta) : "0",
        })
        .onConflictDoUpdate({
          target: [schema.position.marketId, schema.position.userId],
          set:
            outcome === "yes"
              ? { yesShares: sql`${schema.position.yesShares} + ${shareDelta}` }
              : { noShares: sql`${schema.position.noShares} + ${shareDelta}` },
        });

      // trader count += when this is the user's first trade in this market
      const [prior] = await tx
        .select({ id: schema.trade.id })
        .from(schema.trade)
        .where(and(eq(schema.trade.marketId, marketId), eq(schema.trade.userId, u.id)))
        .limit(1);
      const wasFirst = !prior;

      const [updated] = await tx
        .update(schema.market)
        .set({
          qYes: String(newQYes),
          qNo: String(newQNo),
          volumeCents: sql`${schema.market.volumeCents} + ${Math.abs(cashDelta)}`,
          traderCount: wasFirst ? sql`${schema.market.traderCount} + 1` : schema.market.traderCount,
        })
        .where(eq(schema.market.id, marketId))
        .returning({ slug: schema.market.slug });

      await tx.insert(schema.trade).values({
        marketId,
        userId: u.id,
        side,
        outcome,
        shares: String(absShares),
        amountCents: Math.abs(cashDelta),
        yesPriceAfter: newPrice.toFixed(5),
      });
      await tx.insert(schema.pricePoint).values({ marketId, yesPrice: newPrice.toFixed(5) });

      result = { shares: absShares, costCents: Math.abs(cashDelta), price: newPrice };
      revalidatePath(`/market/${updated.slug}`);
    });

    revalidatePath("/");
    revalidatePath("/portfolio");
    revalidatePath("/leaderboard");
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Trade failed" };
  }
}

// ---------- wallet ----------

export async function claimDaily(): Promise<{ ok: boolean; error?: string; amount?: number }> {
  try {
    const u = await requireUser();
    await db.transaction(async (tx) => {
      const user = await lockUser(tx, u.id);
      const last = user.lastClaimAt ? new Date(user.lastClaimAt).getTime() : 0;
      const wait = CLAIM_COOLDOWN_MS - (Date.now() - last);
      if (wait > 0) {
        const h = Math.ceil(wait / 3600000);
        throw new Error(`Next claim available in ~${h}h`);
      }
      await tx.update(schema.user).set({ lastClaimAt: new Date() }).where(eq(schema.user.id, u.id));
      return credit(tx, u.id, CLAIM_AMOUNT, "claim", null, "Daily faucet");
    });
    revalidatePath("/");
    return { ok: true, amount: CLAIM_AMOUNT };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Claim failed" };
  }
}

export async function grantBalance(input: {
  userId: string;
  amountCents: number;
  memo?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    const amt = Math.round(input.amountCents);
    if (!Number.isFinite(amt) || amt === 0) throw new Error("Enter an amount");
    await db.transaction(async (tx) => {
      await lockUser(tx, input.userId);
      await credit(tx, input.userId, amt, "grant", null, input.memo?.trim() || `Grant by ${admin.username ?? "admin"}`);
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Grant failed" };
  }
}

// ---------- markets ----------

export async function proposeMarket(input: {
  question: string;
  description: string;
  category: string;
  closesAt?: string;
}): Promise<{ ok: boolean; error?: string; slug?: string; live?: boolean }> {
  try {
    const u = await requireUser();
    const question = input.question.trim();
    if (question.length < 10) throw new Error("Question too short (min 10 chars)");
    if (question.length > 200) throw new Error("Question too long (max 200)");
    if (input.description.length > 5000) throw new Error("Description too long");
    const isAdmin = u.role === "admin";
    const slug = slugify(question);
    const [m] = await db
      .insert(schema.market)
      .values({
        slug,
        question,
        description: input.description.trim(),
        category: input.category,
        status: isAdmin ? "live" : "pending",
        creatorId: u.id,
        closesAt: input.closesAt ? new Date(input.closesAt) : null,
      })
      .returning({ id: schema.market.id, slug: schema.market.slug });
    if (isAdmin) {
      await db.insert(schema.pricePoint).values({ marketId: m.id, yesPrice: "0.5" });
    }
    revalidatePath("/admin");
    revalidatePath("/");
    return { ok: true, slug: m.slug, live: isAdmin };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create market" };
  }
}

export async function approveMarket(marketId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, marketId);
      if (m.status !== "pending") throw new Error("Not pending");
      await tx.update(schema.market).set({ status: "live" }).where(eq(schema.market.id, marketId));
      await tx.insert(schema.pricePoint).values({ marketId, yesPrice: "0.5" });
    });
    revalidatePath("/admin");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Approve failed" };
  }
}

export async function rejectMarket(marketId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, marketId);
      if (m.status !== "pending") throw new Error("Not pending");
      await tx.update(schema.market).set({ status: "rejected" }).where(eq(schema.market.id, marketId));
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reject failed" };
  }
}

export async function updateMarket(input: {
  marketId: string;
  question: string;
  description: string;
  category: string;
  closesAt?: string;
  b?: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const m = await db.select().from(schema.market).where(eq(schema.market.id, input.marketId)).limit(1);
    if (!m[0]) throw new Error("Market not found");
    if (m[0].status === "resolved") throw new Error("Cannot edit resolved market");
    await db
      .update(schema.market)
      .set({
        question: input.question.trim(),
        description: input.description.trim(),
        category: input.category,
        closesAt: input.closesAt ? new Date(input.closesAt) : null,
        b: input.b && input.b > 0 ? input.b : m[0].b,
      })
      .where(eq(schema.market.id, input.marketId));
    revalidatePath(`/market/${m[0].slug}`);
    revalidatePath("/admin");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function resolveMarket(input: {
  marketId: string;
  outcome: "yes" | "no";
}): Promise<{ ok: boolean; error?: string; paidOut?: number }> {
  try {
    await requireAdmin();
    let paidOut = 0;
    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, input.marketId);
      if (m.status !== "live") throw new Error("Market is not live");
      const positions = await tx
        .select()
        .from(schema.position)
        .where(eq(schema.position.marketId, input.marketId))
        .for("update");
      for (const p of positions) {
        const winShares = input.outcome === "yes" ? toNum(p.yesShares) : toNum(p.noShares);
        const payout = Math.floor(winShares * 100);
        if (payout > 0) {
          await lockUser(tx, p.userId);
          await credit(tx, p.userId, payout, "payout", m.id, `Payout: ${m.question.slice(0, 60)}`);
          paidOut += payout;
        }
      }
      await tx.delete(schema.position).where(eq(schema.position.marketId, input.marketId));
      await tx
        .update(schema.market)
        .set({ status: "resolved", outcome: input.outcome, resolvedAt: new Date() })
        .where(eq(schema.market.id, input.marketId));
      await tx.insert(schema.pricePoint).values({
        marketId: input.marketId,
        yesPrice: input.outcome === "yes" ? "1" : "0",
      });
    });
    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/leaderboard");
    return { ok: true, paidOut };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Resolve failed" };
  }
}

export async function cancelMarket(marketId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, marketId);
      if (m.status === "resolved" || m.status === "cancelled") throw new Error("Already closed");
      const py = marketYesPrice(m);
      const positions = await tx
        .select()
        .from(schema.position)
        .where(eq(schema.position.marketId, marketId))
        .for("update");
      for (const p of positions) {
        const refund = Math.round((toNum(p.yesShares) * py + toNum(p.noShares) * (1 - py)) * 100);
        if (refund > 0) {
          await lockUser(tx, p.userId);
          await credit(tx, p.userId, refund, "refund", m.id, `Refund: ${m.question.slice(0, 60)}`);
        }
      }
      await tx.delete(schema.position).where(eq(schema.position.marketId, marketId));
      await tx.update(schema.market).set({ status: "cancelled" }).where(eq(schema.market.id, marketId));
    });
    revalidatePath("/");
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Cancel failed" };
  }
}

// ---------- comments ----------

export async function addComment(input: {
  marketId: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const body = input.body.trim();
    if (!body) throw new Error("Empty comment");
    if (body.length > 1000) throw new Error("Comment too long (max 1000)");
    await db.insert(schema.comment).values({ marketId: input.marketId, userId: u.id, body });
    const [m] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, input.marketId)).limit(1);
    if (m) revalidatePath(`/market/${m.slug}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Comment failed" };
  }
}

export async function deleteComment(commentId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const [c] = await db.select().from(schema.comment).where(eq(schema.comment.id, commentId)).limit(1);
    if (!c) throw new Error("Not found");
    if (c.userId !== u.id && u.role !== "admin") throw new Error("Not yours");
    await db.delete(schema.comment).where(eq(schema.comment.id, commentId));
    const [m] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, c.marketId)).limit(1);
    if (m) revalidatePath(`/market/${m.slug}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}


