"use server";

import { db, schema } from "@/lib/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { randomInt, createHmac, timingSafeEqual } from "node:crypto";
import { GAME_LEVERAGES, COINFLIP_MULT, diceMult, DICE_MIN_OVER, DICE_MAX_OVER, TIMER_TARGETS, timerMult, LIMBO_MIN, LIMBO_MAX, WHEEL_SEGMENTS, SLOT_SYMBOLS, SLOT_TOTAL_WEIGHT, slotDraw, slotPayout } from "@/lib/games";
import { revalidatePath } from "next/cache";
import { requireUser, requireAdmin, isAdmin } from "@/lib/session";
import { SUPER_ADMIN_EMAIL } from "@/lib/auth";
import { yesPrice, tradeCost, sharesForSpend, qForProb } from "@/lib/lmsr";
import { loanFor, liquidationValueCents, shouldLiquidate } from "@/lib/liq";
import { marketYesPrice, getMarketBetCount } from "@/lib/queries";
import {
  DAILY_AMOUNT,
  DAILY_COOLDOWN_MS,
  WEEKLY_AMOUNT,
  WEEKLY_COOLDOWN_MS,
  AD_AMOUNT,
  AD_COOLDOWN_MS,
  BONUS_MAP,
  REFEREE_BONUS,
  REFERRER_BONUS,
  STREAK_WINDOW_MS,
  STREAK_PER_DAY_CENTS,
  STREAK_CAP_DAYS,
} from "@/lib/rewards";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Crude spam brakes for a friends group — recent-row counts on the live
// tables, generous thresholds, no new infra.
async function assertNotSpam(userId: string, kind: "trade" | "game" | "comment") {
  const limits = { trade: 60, game: 60, comment: 5 };
  const max = limits[kind];
  let n = 0;
  if (kind === "comment") {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.comment)
      .where(and(eq(schema.comment.userId, userId), sql`${schema.comment.createdAt} > now() - interval '5 minutes'`));
    n = r?.n ?? 0;
  } else if (kind === "game") {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.ledger)
      .where(and(eq(schema.ledger.userId, userId), eq(schema.ledger.kind, "game"), sql`${schema.ledger.createdAt} > now() - interval '5 minutes'`));
    n = r?.n ?? 0;
  } else {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.trade)
      .where(and(eq(schema.trade.userId, userId), sql`${schema.trade.createdAt} > now() - interval '5 minutes'`));
    n = r?.n ?? 0;
  }
  if (n >= max) throw new Error("Too fast — wait a few minutes");
}

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

// After an option resolves/cancels, roll the group up: no live options left
// means the group itself is done.
async function syncGroupStatus(tx: Tx, m: typeof schema.market.$inferSelect) {
  if (!m.parentId) return;
  const sibs = await tx
    .select({ status: schema.market.status })
    .from(schema.market)
    .where(eq(schema.market.parentId, m.parentId));
  if (sibs.some((s) => s.status === "live")) return;
  await tx
    .update(schema.market)
    .set({
      status: sibs.some((s) => s.status === "resolved") ? "resolved" : "cancelled",
      resolvedAt: new Date(),
    })
    .where(eq(schema.market.id, m.parentId));
  const [parent] = await tx.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, m.parentId)).limit(1);
  if (parent) revalidatePath(`/market/${parent.slug}`);
}

// ---------- trading ----------

// Leverage: the user posts `spend` as collateral and the house lends the rest,
// so `notional = spend × leverage` worth of shares. The loan lives on the
// position row as debtCents and is repaid out of sells/resolves/refunds.
const TRADE_LEVERAGES = [1, 2, 3, 5, 10];

// If a leveraged position's liquidation value drops to the debt (5% cushion),
// force-sell it into the book, repay the loan, hand back any leftover equity.
// Runs inside the trade tx after the book moved — sequential sells keep the
// q's honest as each liquidation moves the price.
async function checkLiquidations(tx: Tx, marketId: string) {
  const m = await lockMarket(tx, marketId);
  let qy = toNum(m.qYes);
  let qn = toNum(m.qNo);
  const rows = await tx
    .select()
    .from(schema.position)
    .where(and(eq(schema.position.marketId, marketId), sql`${schema.position.debtCents} > 0`))
    .for("update");
  let touched = false;
  for (const p of rows) {
    const y = toNum(p.yesShares);
    const n = toNum(p.noShares);
    const valueCents = liquidationValueCents(qy, qn, m.b, y, n);
    if (!shouldLiquidate(valueCents, p.debtCents)) continue;
    qy -= y;
    qn -= n;
    const equity = Math.max(0, valueCents - p.debtCents);
    if (equity > 0) {
      await lockUser(tx, p.userId);
      await credit(tx, p.userId, equity, "liq", marketId, `Liquidated: ${m.question.slice(0, 60)}`);
    }
    await tx
      .delete(schema.position)
      .where(and(eq(schema.position.marketId, marketId), eq(schema.position.userId, p.userId)));
    touched = true;
  }
  if (touched) {
    await tx.update(schema.market).set({ qYes: String(qy), qNo: String(qn) }).where(eq(schema.market.id, marketId));
    await tx.insert(schema.pricePoint).values({ marketId, yesPrice: yesPrice(qy, qn, m.b).toFixed(5) });
  }
}

export async function placeTrade(input: {
  marketId: string;
  outcome: "yes" | "no";
  side: "buy" | "sell";
  spendCents?: number;
  shares?: number;
  leverage?: number;
}): Promise<{ ok: true; shares: number; costCents: number; price: number } | { ok: false; error: string }> {
  try {
    const u = await requireUser();
    const { marketId, outcome, side } = input;
    if (outcome !== "yes" && outcome !== "no") throw new Error("Bad outcome");
    await assertNotSpam(u.id, "trade");

    let result!: { shares: number; costCents: number; price: number };

    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, marketId);
      if (m.kind === "group") throw new Error("Trade one of this market's options");
      if (m.status !== "live") throw new Error("Market is not live");
      if (m.closesAt && new Date(m.closesAt) < new Date()) throw new Error("Market is closed");
      await lockUser(tx, u.id);

      const qYes = toNum(m.qYes);
      const qNo = toNum(m.qNo);
      const b = m.b;

      let shares: number;
      let cashDelta: number; // negative = pay, positive = receive
      let debtDelta = 0; // new loan principal on leveraged buys
      let debtRepay = 0; // loan repaid out of sell proceeds

      if (side === "buy") {
        const spend = Math.round(input.spendCents ?? 0);
        const leverage = Math.round(input.leverage ?? 1);
        if (!Number.isFinite(spend) || spend < 100) throw new Error("Minimum trade is Ɱ1");
        if (!TRADE_LEVERAGES.includes(leverage)) throw new Error("Bad leverage");
        if (leverage > m.maxLeverage) throw new Error(`Max leverage on this market is ${m.maxLeverage}×`);
        const notional = spend * leverage;
        shares = sharesForSpend(qYes, qNo, b, outcome, notional / 100);
        if (shares <= 0) throw new Error("Trade too small");
        cashDelta = -spend; // collateral only — the loan makes up the rest
        debtDelta = loanFor(spend, leverage);
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
        const payout = -tradeCost(qYes, qNo, b, outcome, shares); // sell delta is negative — negate for proceeds
        cashDelta = Math.round(payout * 100); // nearest cent
        if (cashDelta <= 0) throw new Error("Nothing to refund");
        // Proceeds service the loan first; the seller keeps the remainder.
        debtRepay = Math.min(cashDelta, pos?.debtCents ?? 0);
        cashDelta -= debtRepay;
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
        `${side === "buy" ? "Bought" : "Sold"} ${absShares.toFixed(2)} ${outcome.toUpperCase()} @ ${(outcome === "yes" ? newPrice : 1 - newPrice).toFixed(2)}` +
          (debtDelta > 0 ? ` · ${input.leverage}x` : debtRepay > 0 ? " · loan repaid" : "")
      );

      // upsert position (shares delta + loan delta)
      const shareSet =
        outcome === "yes"
          ? { yesShares: sql`${schema.position.yesShares} + ${shareDelta}` }
          : { noShares: sql`${schema.position.noShares} + ${shareDelta}` };
      await tx
        .insert(schema.position)
        .values({
          marketId,
          userId: u.id,
          yesShares: outcome === "yes" ? String(shareDelta) : "0",
          noShares: outcome === "no" ? String(shareDelta) : "0",
          debtCents: debtDelta,
        })
        .onConflictDoUpdate({
          target: [schema.position.marketId, schema.position.userId],
          set:
            debtDelta === 0 && debtRepay === 0
              ? shareSet
              : {
                  ...shareSet,
                  debtCents: sql`${schema.position.debtCents} + ${debtDelta} - ${debtRepay}`,
                },
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

      // The book just moved — flush any leveraged position that can't cover
      // its loan at the new prices.
      await checkLiquidations(tx, marketId);

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

export async function claimDaily(): Promise<{
  ok: boolean;
  error?: string;
  amount?: number;
  retryInH?: number;
  retryInMs?: number;
}> {
  try {
    const u = await requireUser();
    const paid = await db.transaction(async (tx) => {
      const user = await lockUser(tx, u.id);
      const last = user.lastClaimAt ? new Date(user.lastClaimAt).getTime() : 0;
      const wait = DAILY_COOLDOWN_MS - (Date.now() - last);
      if (wait > 0) {
        const err = new Error("cooldown") as Error & { retryInH: number; retryInMs: number };
        err.retryInH = Math.ceil(wait / 3600000);
        err.retryInMs = wait;
        throw err;
      }
      const streak =
        last === 0 ? 1 : Date.now() - last <= STREAK_WINDOW_MS ? user.claimStreak + 1 : 1;
      const bonus = Math.min(streak, STREAK_CAP_DAYS) * STREAK_PER_DAY_CENTS;
      await tx
        .update(schema.user)
        .set({ lastClaimAt: new Date(), claimStreak: streak })
        .where(eq(schema.user.id, u.id));
      await credit(tx, u.id, DAILY_AMOUNT + bonus, "claim", null, `Daily faucet · day ${streak} streak`);
      return DAILY_AMOUNT + bonus;
    });
    revalidatePath("/");
    return { ok: true, amount: paid };
  } catch (e) {
    const { retryInH: h, retryInMs } = e as { retryInH?: number; retryInMs?: number };
    return { ok: false, error: e instanceof Error ? e.message : "Claim failed", retryInH: h, retryInMs };
  }
}

// Recurring rewards (weekly faucet, ad views) share one ledger table: latest
// claim per kind drives the cooldown; one-time bonuses use the unique index.
async function claimRecurring(
  kind: "weekly" | "ad",
  cooldownMs: number,
  amountCents: number,
  memo: string
): Promise<{ ok: boolean; error?: string; retryInH?: number }> {
  try {
    const u = await requireUser();
    await db.transaction(async (tx) => {
      await lockUser(tx, u.id);
      const [last] = await tx
        .select({ createdAt: schema.rewardClaim.createdAt })
        .from(schema.rewardClaim)
        .where(and(eq(schema.rewardClaim.userId, u.id), eq(schema.rewardClaim.kind, kind)))
        .orderBy(desc(schema.rewardClaim.createdAt))
        .limit(1)
        .for("update");
      const wait = last ? cooldownMs - (Date.now() - new Date(last.createdAt).getTime()) : 0;
      if (wait > 0) {
        const err = new Error("cooldown") as Error & { retryInH: number };
        err.retryInH = Math.ceil(wait / 3600000);
        throw err;
      }
      await tx.insert(schema.rewardClaim).values({ userId: u.id, kind, amountCents });
      await credit(tx, u.id, amountCents, kind, null, memo);
    });
    revalidatePath("/rewards");
    return { ok: true };
  } catch (e) {
    const h = (e as { retryInH?: number }).retryInH;
    return { ok: false, error: e instanceof Error ? e.message : "Claim failed", retryInH: h };
  }
}

export async function claimWeekly() {
  return claimRecurring("weekly", WEEKLY_COOLDOWN_MS, WEEKLY_AMOUNT, "Weekly faucet");
}

export async function claimAdReward() {
  return claimRecurring("ad", AD_COOLDOWN_MS, AD_AMOUNT, "Ad reward");
}

export async function claimBonus(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const bonus = BONUS_MAP.get(key as never);
    if (!bonus) throw new Error("Unknown reward");

    await db.transaction(async (tx) => {
      await lockUser(tx, u.id);
      const [existing] = await tx
        .select({ id: schema.rewardClaim.id })
        .from(schema.rewardClaim)
        .where(and(eq(schema.rewardClaim.userId, u.id), eq(schema.rewardClaim.kind, `bonus:${key}`)))
        .limit(1);
      if (existing) throw new Error("Already claimed");

      // Milestone bonuses are verified against real activity.
      if (bonus.check === "bet") {
        const [t] = await tx.select({ id: schema.trade.id }).from(schema.trade).where(eq(schema.trade.userId, u.id)).limit(1);
        if (!t) throw new Error("Place a bet first");
      } else if (bonus.check === "market") {
        const [m] = await tx.select({ id: schema.market.id }).from(schema.market).where(eq(schema.market.creatorId, u.id)).limit(1);
        if (!m) throw new Error("Create a market first");
      } else if (bonus.check === "comment") {
        const [c] = await tx.select({ id: schema.comment.id }).from(schema.comment).where(eq(schema.comment.userId, u.id)).limit(1);
        if (!c) throw new Error("Post a comment first");
      }

      try {
        await tx.insert(schema.rewardClaim).values({ userId: u.id, kind: `bonus:${key}`, amountCents: bonus.amountCents });
      } catch {
        throw new Error("Already claimed"); // unique index raced us
      }
      await credit(tx, u.id, bonus.amountCents, "bonus", null, `Bonus: ${key}`);
    });
    revalidatePath("/rewards");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Claim failed" };
  }
}

// Avatar: client compresses to a ~256px JPEG data URL; kept in user.image.
export async function updateAvatar(image: string | null): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    if (image !== null) {
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) throw new Error("Bad image format");
      if (image.length > 120_000) throw new Error("Image too large");
    }
    await db.update(schema.user).set({ image }).where(eq(schema.user.id, u.id));
    revalidatePath("/");
    revalidatePath("/portfolio");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed" };
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

// Everyone can open a live market. The creator sets the starting odds and
// liquidity; the LMSR takes it from there.
const LIQUIDITY_OPTIONS = [100, 300, 900] as const;
const NEW_CATEGORY = "__new__";

function normalizeCategory(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) throw new Error("Category required");
  if (s.length > 24) throw new Error("Category name too long (max 24)");
  return s;
}

// Resolves the market's category: an existing one, or a brand-new user-defined
// one created on the fly (case-insensitive dedupe).
async function resolveCategory(tx: Tx, input: { category: string; newCategory?: string }, userId: string) {
  if (input.category !== NEW_CATEGORY) return input.category;
  const name = normalizeCategory(input.newCategory ?? "");
  const [existing] = await tx
    .select({ name: schema.category.name })
    .from(schema.category)
    .where(sql`lower(${schema.category.name}) = lower(${name})`)
    .limit(1);
  if (existing) return existing.name;
  const [max] = await tx.select({ n: sql<number>`coalesce(max(${schema.category.sortIndex}),0)::int` }).from(schema.category);
  await tx.insert(schema.category).values({ name, sortIndex: (max?.n ?? 0) + 1, creatorId: userId });
  return name;
}

export async function createCategory(input: { name: string }): Promise<{ ok: boolean; error?: string; name?: string }> {
  try {
    const u = await requireUser();
    const name = await db.transaction(async (tx) => {
      const n = normalizeCategory(input.name);
      const [existing] = await tx
        .select({ name: schema.category.name })
        .from(schema.category)
        .where(sql`lower(${schema.category.name}) = lower(${n})`)
        .limit(1);
      if (existing) return existing.name;
      const [max] = await tx.select({ n: sql<number>`coalesce(max(${schema.category.sortIndex}),0)::int` }).from(schema.category);
      await tx.insert(schema.category).values({ name: n, sortIndex: (max?.n ?? 0) + 1, creatorId: u.id });
      return n;
    });
    revalidatePath("/");
    revalidatePath("/admin");
    return { ok: true, name };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create category" };
  }
}

export async function renameCategory(input: { from: string; to: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const to = normalizeCategory(input.to);
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ name: schema.category.name })
        .from(schema.category)
        .where(sql`lower(${schema.category.name}) = lower(${to})`)
        .limit(1);
      if (existing && existing.name !== input.from) throw new Error("A category with that name exists");
      await tx.update(schema.category).set({ name: to }).where(eq(schema.category.name, input.from));
      await tx.update(schema.market).set({ category: to }).where(eq(schema.market.category, input.from));
    });
    revalidatePath("/");
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Rename failed" };
  }
}

export async function reorderCategories(input: { names: string[] }): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    await db.transaction(async (tx) => {
      for (const [i, name] of input.names.entries()) {
        await tx.update(schema.category).set({ sortIndex: i + 1 }).where(eq(schema.category.name, name));
      }
    });
    revalidatePath("/");
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reorder failed" };
  }
}

export async function deleteCategory(input: { name: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const [used] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.market)
      .where(eq(schema.market.category, input.name));
    if ((used?.n ?? 0) > 0) throw new Error(`Category is used by ${used.n} market(s)`);
    await db.delete(schema.category).where(eq(schema.category.name, input.name));
    revalidatePath("/");
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}

export async function proposeMarket(input: {
  question: string;
  description: string;
  imageUrl?: string; // market icon — URL or data:image from the form's cell
  category: string;
  newCategory?: string;
  closesAt?: string;
  initialProb?: number;
  liquidity?: number;
  outcomes?: string[];
  optionProbs?: number[]; // per-option opening odds in %, parallel to outcomes
  recurDays?: number; // auto-clone the market this many days after close
  maxLeverage?: number; // leverage ceiling for buys — defaults to 10x
}): Promise<{ ok: boolean; error?: string; slug?: string; live?: boolean }> {
  try {
    const u = await requireUser();
    const question = input.question.trim();
    if (question.length < 10) throw new Error("Question too short (min 10 chars)");
    if (question.length > 200) throw new Error("Question too long (max 200)");
    if (input.description.length > 5000) throw new Error("Description too long");
    const b = LIQUIDITY_OPTIONS.includes(input.liquidity as 100) ? input.liquidity! : 300;
    const p = Math.min(0.97, Math.max(0.03, input.initialProb ?? 0.5));
    const description = input.description.trim();
    const closesAt = input.closesAt ? new Date(input.closesAt) : null;
    const recurDays = [7, 14, 30].includes(input.recurDays ?? 0) ? input.recurDays! : null;
    const maxLeverage = TRADE_LEVERAGES.includes(input.maxLeverage ?? 10) ? input.maxLeverage! : 10;
    const marketImage = input.imageUrl?.trim() || null;
    if (marketImage) {
      const isData = /^data:image\/(jpeg|png|webp);base64,/.test(marketImage) || /^data:image\/svg\+xml[;,]/.test(marketImage);
      if (!isData && !/^(https?:\/\/|\/)\S+$/.test(marketImage)) throw new Error("Bad image URL");
      if (isData && marketImage.length > 450_000) throw new Error("Image too large");
    }

    // Options may carry an image: "Democratic Party | https://…/logo.png" —
    // data URLs come from the form's upload/paste cell.
    const parsed = (input.outcomes ?? [])
      .map((o) => o.trim())
      .filter(Boolean)
      .map((line) => {
        const [label, url] = line.split("|").map((s) => s.trim());
        if (url) {
          const isData = /^data:image\/(jpeg|png|webp);base64,/.test(url) || /^data:image\/svg\+xml[;,]/.test(url);
          const isUrl = /^(https?:\/\/|\/)\S+$/.test(url);
          if (!isData && !isUrl) throw new Error(`Bad image URL for "${label}"`);
          if (isData && url.length > 450_000) throw new Error(`Image too large for "${label}"`);
        }
        return { label, imageUrl: url || null };
      });
    const seen = new Set<string>();
    const options = parsed.filter((o) => (seen.has(o.label.toLowerCase()) ? false : (seen.add(o.label.toLowerCase()), true)));
    if (options.length === 1) throw new Error("Add at least 2 options, or leave options empty");
    if (options.length > 12) throw new Error("Max 12 options");
    if (options.some((o) => o.label.length > 60 || o.label.length === 0)) throw new Error("Option labels max 60 chars");

    const slug = await db.transaction(async (tx) => {
      const category = await resolveCategory(tx, input, u.id);
      if (options.length >= 2) {
        const [parent] = await tx
          .insert(schema.market)
          .values({
            slug: slugify(question),
            question,
            description,
            category,
            status: "live",
            kind: "group",
            creatorId: u.id,
            b,
            closesAt,
            maxLeverage,
            imageUrl: marketImage,
          })
          .returning({ id: schema.market.id, slug: schema.market.slug });
        const base = question.replace(/[?？!.\s]+$/g, "");
        for (const [i, opt] of options.entries()) {
          const { label } = opt;
          // Per-option opening odds — clamped 1–99%, falling back to the
          // shared slider value when a probability is missing.
          const pi = Math.min(0.99, Math.max(0.01, (input.optionProbs?.[i] ?? p * 100) / 100));
          const [child] = await tx
            .insert(schema.market)
            .values({
              slug: slugify(`${base} ${label}`),
              question: `${base} — ${label}?`,
              description,
              category,
              status: "live",
              kind: "option",
              parentId: parent.id,
              label,
              imageUrl: opt.imageUrl,
              sortIndex: i,
              creatorId: u.id,
              b,
              qYes: qForProb(pi, b).toFixed(6),
              qNo: "0",
              closesAt,
              maxLeverage,
            })
            .returning({ id: schema.market.id });
          await tx.insert(schema.pricePoint).values({ marketId: child.id, yesPrice: pi.toFixed(5) });
        }
        return parent.slug;
      }

      const [m] = await tx
        .insert(schema.market)
        .values({
          slug: slugify(question),
          question,
          description,
          category,
          status: "live",
          creatorId: u.id,
          b,
          qYes: qForProb(p, b).toFixed(6),
          qNo: "0",
          closesAt,
          recurDays,
          maxLeverage,
          imageUrl: marketImage,
        })
        .returning({ id: schema.market.id, slug: schema.market.slug });
      await tx.insert(schema.pricePoint).values({ marketId: m.id, yesPrice: p.toFixed(5) });
      return m.slug;
    });

    revalidatePath("/admin");
    revalidatePath("/");
    return { ok: true, slug, live: true };
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
      await tx.insert(schema.pricePoint).values({ marketId, yesPrice: marketYesPrice(m).toFixed(5) });
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

// Creator or admin can edit a market. Once bets exist, the question itself is
// locked — changing what traders bet on mid-flight is what breaks a live
// prediction. Rules text, category, image, and the close date stay editable.
export async function updateMarket(input: {
  marketId: string;
  question: string;
  description: string;
  category: string;
  imageUrl?: string;
  closesAt?: string;
  b?: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const m = await db.select().from(schema.market).where(eq(schema.market.id, input.marketId)).limit(1);
    if (!m[0]) throw new Error("Market not found");
    const admin = isAdmin(u);
    if (!admin && m[0].creatorId !== u.id) throw new Error("Only the creator or an admin can edit");
    if (m[0].status === "resolved") throw new Error("Cannot edit resolved market");
    if (input.imageUrl && !/^(https?:\/\/|\/)\S+$/.test(input.imageUrl.trim()) && !/^data:image\/(jpeg|png|webp);base64,|^data:image\/svg\+xml[;,]/.test(input.imageUrl.trim())) throw new Error("Bad image URL");

    const question = input.question.trim();
    if (question !== m[0].question) {
      const bets = await getMarketBetCount(m[0].id);
      if (bets > 0) throw new Error("Question is locked once bets are placed");
    }
    await db
      .update(schema.market)
      .set({
        question,
        description: input.description.trim(),
        category: input.category,
        imageUrl: input.imageUrl !== undefined ? input.imageUrl.trim() || null : m[0].imageUrl,
        closesAt: input.closesAt ? new Date(input.closesAt) : null,
        b: admin && input.b && input.b > 0 ? input.b : m[0].b,
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

// Shared settle path — pays positions, closes the market, notifies watchers,
// and clones recurring markets. Called by direct resolves and by the
// community vote threshold.
async function settleMarketTx(
  tx: Tx,
  m: typeof schema.market.$inferSelect,
  outcome: "yes" | "no",
  reason: string
): Promise<number> {
  let paidOut = 0;
  const positions = await tx
    .select()
    .from(schema.position)
    .where(eq(schema.position.marketId, m.id))
    .for("update");
  for (const p of positions) {
    const winShares = outcome === "yes" ? toNum(p.yesShares) : toNum(p.noShares);
    // Leveraged positions settle the loan first; winners keep the rest.
    const payout = Math.max(0, Math.floor(winShares * 100) - p.debtCents);
    if (payout > 0) {
      await lockUser(tx, p.userId);
      await credit(tx, p.userId, payout, "payout", m.id, `Payout: ${m.question.slice(0, 60)}`);
      paidOut += payout;
    }
  }
  await tx.delete(schema.position).where(eq(schema.position.marketId, m.id));
  await tx
    .update(schema.market)
    .set({
      status: "resolved",
      outcome,
      resolvedAt: new Date(),
      resolutionReason: reason,
      proposedOutcome: null,
      proposedById: null,
      proposedAt: null,
    })
    .where(eq(schema.market.id, m.id));
  await tx.delete(schema.resolutionVote).where(eq(schema.resolutionVote.marketId, m.id));
  await tx.insert(schema.pricePoint).values({
    marketId: m.id,
    yesPrice: outcome === "yes" ? "1" : "0",
  });
  // Fan out to watchers + the creator — position holders already got
  // payout rows, so only notify users who didn't receive money.
  const paidUsers = new Set(positions.map((p) => p.userId));
  const watchers = await tx
    .select({ userId: schema.watchlist.userId })
    .from(schema.watchlist)
    .where(eq(schema.watchlist.marketId, m.id));
  const notifyIds = new Set([m.creatorId, ...watchers.map((w) => w.userId)].filter((x): x is string => !!x));
  for (const uid of notifyIds) {
    if (paidUsers.has(uid)) continue;
    const [w] = await tx
      .select({ balanceCents: schema.user.balanceCents, notifResolve: schema.user.notifResolve })
      .from(schema.user)
      .where(eq(schema.user.id, uid))
      .limit(1);
    if (!w || !w.notifResolve) continue;
    await tx.insert(schema.ledger).values({
      userId: uid,
      amountCents: 0,
      balanceAfterCents: w.balanceCents,
      kind: "notify",
      marketId: m.id,
      memo: `Resolved ${outcome.toUpperCase()}: ${m.question.slice(0, 80)}`,
    });
  }
  await syncGroupStatus(tx, m);

  // Recurring markets: open a fresh copy closing recurDays after this close.
  // Options stay out — a group's recurrence is driven by its own pattern.
  if (m.recurDays && !m.parentId && m.kind !== "group") {
    const nextClose = new Date((m.closesAt?.getTime() ?? Date.now()) + m.recurDays * 24 * 3600 * 1000);
    const [clone] = await tx
      .insert(schema.market)
      .values({
        slug: `${m.slug.slice(0, 80)}-${nextClose.toISOString().slice(0, 10)}`,
        question: m.question,
        description: m.description,
        category: m.category,
        status: "live",
        kind: "binary",
        creatorId: m.creatorId,
        b: m.b,
        recurDays: m.recurDays,
        imageUrl: m.imageUrl,
        closesAt: nextClose,
      })
      .returning({ id: schema.market.id });
    await tx.insert(schema.pricePoint).values({ marketId: clone.id, yesPrice: "0.5" });
  }
  return paidOut;
}

export async function resolveMarket(input: {
  marketId: string;
  outcome: "yes" | "no";
  reason?: string;
}): Promise<{ ok: boolean; error?: string; paidOut?: number }> {
  try {
    const u = await requireUser();
    let paidOut = 0;
    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, input.marketId);
      if (!isAdmin(u) && m.creatorId !== u.id) throw new Error("Only the creator or an admin can resolve");
      if (m.kind === "group") throw new Error("Resolve the group's options instead");
      if (m.status !== "live") throw new Error("Market is not live");
      // A disputed market is out of the creator's hands — only admins settle it.
      const [d] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.resolutionVote)
        .where(and(eq(schema.resolutionVote.marketId, m.id), eq(schema.resolutionVote.vote, "dispute")));
      if ((d?.n ?? 0) > 0 && !isAdmin(u)) throw new Error("Resolution is disputed — an admin must resolve");
      paidOut = await settleMarketTx(tx, m, input.outcome, (input.reason ?? "").trim().slice(0, 500));
    });
    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/leaderboard");
    const [self] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, input.marketId)).limit(1);
    if (self) revalidatePath(`/market/${self.slug}`);
    return { ok: true, paidOut };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Resolve failed" };
  }
}

// Community resolution — once a market is expired anyone signed in may propose
// the outcome; two confirm votes settle it, disputes send it to admins.
export async function proposeResolution(input: {
  marketId: string;
  outcome: "yes" | "no";
  reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, input.marketId);
      if (m.kind === "group" || m.status !== "live") throw new Error("Not resolvable");
      if (!m.closesAt || m.closesAt > new Date()) throw new Error("Market hasn't closed yet");
      // A new proposal resets the vote tally.
      await tx.delete(schema.resolutionVote).where(eq(schema.resolutionVote.marketId, m.id));
      await tx
        .update(schema.market)
        .set({
          proposedOutcome: input.outcome,
          proposedById: u.id,
          proposedAt: new Date(),
          resolutionReason: (input.reason ?? "").trim().slice(0, 500),
        })
        .where(eq(schema.market.id, m.id));
    });
    revalidatePath("/");
    const [self] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, input.marketId)).limit(1);
    if (self) revalidatePath(`/market/${self.slug}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Proposal failed" };
  }
}

export async function voteResolution(input: {
  marketId: string;
  vote: "confirm" | "dispute";
}): Promise<{ ok: boolean; error?: string; resolved?: boolean }> {
  try {
    const u = await requireUser();
    let resolved = false;
    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, input.marketId);
      if (m.status !== "live" || !m.proposedOutcome) throw new Error("No active proposal");
      if (m.proposedById === u.id) throw new Error("You proposed this outcome");
      await tx
        .insert(schema.resolutionVote)
        .values({ marketId: m.id, userId: u.id, vote: input.vote })
        .onConflictDoUpdate({
          target: [schema.resolutionVote.marketId, schema.resolutionVote.userId],
          set: { vote: input.vote },
        });
      const [c] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.resolutionVote)
        .where(
          and(
            eq(schema.resolutionVote.marketId, m.id),
            eq(schema.resolutionVote.vote, "confirm")
          )
        );
      const [d] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.resolutionVote)
        .where(
          and(
            eq(schema.resolutionVote.marketId, m.id),
            eq(schema.resolutionVote.vote, "dispute")
          )
        );
      // Two confirms with no disputes settles the market at the proposal.
      if ((c?.n ?? 0) >= 2 && (d?.n ?? 0) === 0) {
        await settleMarketTx(tx, m, m.proposedOutcome === "no" ? "no" : "yes", m.resolutionReason);
        resolved = true;
      }
    });
    revalidatePath("/");
    revalidatePath("/admin");
    const [self] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, input.marketId)).limit(1);
    if (self) revalidatePath(`/market/${self.slug}`);
    return { ok: true, resolved };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Vote failed" };
  }
}

// Hard-delete a market and everything attached (group parents take their
// options with them via cascade). Admins can delete anything — holders are
// refunded at the current mark first, so nobody loses Marks to a deletion.
// Creators may delete only their own market while nobody has bet on it.
export async function deleteMarket(marketId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const slug = await db.transaction(async (tx) => {
      const m = await lockMarket(tx, marketId);
      const targets = await tx
        .select()
        .from(schema.market)
        .where(sql`${schema.market.id} = ${m.id} OR ${schema.market.parentId} = ${m.id}`)
        .for("update");
      const ids = targets.map((x) => x.id);
      const [bets] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.trade)
        .where(sql`${schema.trade.marketId} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);

      const admin = isAdmin(u);
      if (!admin) {
        if (m.creatorId !== u.id) throw new Error("Only the creator can delete this market");
        if ((bets?.n ?? 0) > 0) throw new Error("Cannot delete — bets were already placed");
      } else {
        // Admin nuke: refund open positions at mark before wiping.
        for (const t of targets) {
          const py = marketYesPrice(t);
          const positions = await tx
            .select()
            .from(schema.position)
            .where(eq(schema.position.marketId, t.id))
            .for("update");
          for (const p of positions) {
            const refund = Math.max(0, Math.round((toNum(p.yesShares) * py + toNum(p.noShares) * (1 - py)) * 100) - p.debtCents);
            if (refund > 0) {
              await lockUser(tx, p.userId);
              await credit(tx, p.userId, refund, "refund", t.id, `Removed: ${t.question.slice(0, 60)}`);
            }
          }
        }
      }
      // Deleting the parent cascades children; for singles it's just the row.
      await tx.delete(schema.market).where(eq(schema.market.id, m.id));
      return m.slug;
    });
    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath(`/market/${slug}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}

// Admin-only: create a user account directly (username + password). The
// welcome-bonus ledger entry is inserted manually because direct inserts skip
// the Better Auth database hooks.
export async function adminCreateUser(input: {
  username: string;
  password: string;
  role?: "user" | "admin";
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const { hashPassword } = await import("better-auth/crypto");
    const username = input.username.trim().toLowerCase();
    if (username.length < 3) throw new Error("Username too short (min 3)");
    if (!/^[a-z0-9_.-]+$/.test(username)) throw new Error("Username: letters, digits, _ . - only");
    if (input.password.length < 6) throw new Error("Password too short (min 6)");
    const role = input.role === "admin" ? "admin" : "user";

    await db.transaction(async (tx) => {
      const dupe = await tx
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(sql`lower(${schema.user.username}) = ${username}`)
        .limit(1);
      if (dupe.length) throw new Error("Username taken");
      const id = crypto.randomUUID();
      const email = `${username}@monobet.local`;
      await tx.insert(schema.user).values({
        id,
        name: username,
        email,
        username,
        displayUsername: username,
        role,
      });
      await tx.insert(schema.account).values({
        id: crypto.randomUUID(),
        accountId: id,
        providerId: "credential",
        userId: id,
        password: await hashPassword(input.password),
      });
      await tx.insert(schema.ledger).values({
        userId: id,
        amountCents: 100_000,
        balanceAfterCents: 100_000,
        kind: "signup",
        memo: "Welcome bonus",
      });
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Create user failed" };
  }
}

// ---------- admin: user management ----------

// Target must exist and can't be the acting admin or the owner account.
async function assertManageableUser(userId: string, adminId: string) {
  if (userId === adminId) throw new Error("Can't modify your own account here");
  const [target] = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  if (!target) throw new Error("User not found");
  if ((target.email ?? "").toLowerCase() === SUPER_ADMIN_EMAIL) throw new Error("The owner account can't be modified");
}

export async function adminSetUserBanned(input: {
  userId: string;
  banned: boolean;
  reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    await assertManageableUser(input.userId, admin.id);
    await db.transaction(async (tx) => {
      await tx
        .update(schema.user)
        .set({
          bannedAt: input.banned ? new Date() : null,
          banReason: input.banned ? (input.reason ?? "").trim().slice(0, 200) || null : null,
        })
        .where(eq(schema.user.id, input.userId));
      // Drop live sessions so the ban bites immediately.
      if (input.banned) await tx.delete(schema.session).where(eq(schema.session.userId, input.userId));
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function adminSetCommentsBanned(input: {
  userId: string;
  banned: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    await assertManageableUser(input.userId, admin.id);
    await db.update(schema.user).set({ commentsBanned: input.banned }).where(eq(schema.user.id, input.userId));
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function adminSetUserRole(input: {
  userId: string;
  role: "user" | "admin";
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    if (input.role !== "user" && input.role !== "admin") throw new Error("Bad role");
    await assertManageableUser(input.userId, admin.id);
    await db.update(schema.user).set({ role: input.role }).where(eq(schema.user.id, input.userId));
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}

// Sets a brand-new password and drops existing sessions, so the user logs in
// with the new credentials next. Works even if the account somehow has no
// credential row yet.
export async function adminResetUserPassword(input: {
  userId: string;
  password: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    if (input.password.length < 6) throw new Error("Password too short (min 6)");
    await assertManageableUser(input.userId, admin.id);
    const { hashPassword } = await import("better-auth/crypto");
    const hash = await hashPassword(input.password);
    await db.transaction(async (tx) => {
      const [acc] = await tx
        .select({ id: schema.account.id })
        .from(schema.account)
        .where(and(eq(schema.account.userId, input.userId), eq(schema.account.providerId, "credential")))
        .limit(1);
      if (acc) {
        await tx.update(schema.account).set({ password: hash, updatedAt: new Date() }).where(eq(schema.account.id, acc.id));
      } else {
        await tx.insert(schema.account).values({
          id: crypto.randomUUID(),
          accountId: input.userId,
          providerId: "credential",
          userId: input.userId,
          password: hash,
        });
      }
      await tx.delete(schema.session).where(eq(schema.session.userId, input.userId));
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reset failed" };
  }
}

export async function cancelMarket(marketId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, marketId);
      if (!isAdmin(u) && m.creatorId !== u.id) throw new Error("Only the creator or an admin can cancel");
      if (m.kind === "group") throw new Error("Cancel the group's options instead");
      if (m.status === "resolved" || m.status === "cancelled") throw new Error("Already closed");
      const py = marketYesPrice(m);
      const positions = await tx
        .select()
        .from(schema.position)
        .where(eq(schema.position.marketId, marketId))
        .for("update");
      for (const p of positions) {
        const refund = Math.max(0, Math.round((toNum(p.yesShares) * py + toNum(p.noShares) * (1 - py)) * 100) - p.debtCents);
        if (refund > 0) {
          await lockUser(tx, p.userId);
          await credit(tx, p.userId, refund, "refund", m.id, `Refund: ${m.question.slice(0, 60)}`);
        }
      }
      await tx.delete(schema.position).where(eq(schema.position.marketId, marketId));
      await tx.update(schema.market).set({ status: "cancelled" }).where(eq(schema.market.id, marketId));
      await syncGroupStatus(tx, m);
      revalidatePath(`/market/${m.slug}`);
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
  image?: string | null;
  parentId?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    if (u.commentsBanned) throw new Error("Comments are disabled for your account");
    await assertNotSpam(u.id, "comment");
    const body = input.body.trim();
    if (!body) throw new Error("Empty comment");
    if (body.length > 1000) throw new Error("Comment too long (max 1000)");
    const image = input.image ?? null;
    if (image) {
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) throw new Error("Bad image format");
      if (image.length > 450_000) throw new Error("Image too large");
    }
    // Replies hang one level deep — the parent must be a top-level comment on
    // this market, never another reply.
    let parentId: string | null = null;
    if (input.parentId) {
      const [p] = await db
        .select({ marketId: schema.comment.marketId, parentId: schema.comment.parentId })
        .from(schema.comment)
        .where(eq(schema.comment.id, input.parentId))
        .limit(1);
      if (!p || p.marketId !== input.marketId || p.parentId) throw new Error("Bad parent");
      parentId = input.parentId;
    }
    await db.insert(schema.comment).values({ marketId: input.marketId, userId: u.id, body, imageUrl: image, parentId });
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
    if (c.userId !== u.id && !isAdmin(u)) throw new Error("Not yours");
    await db.delete(schema.comment).where(eq(schema.comment.id, commentId));
    const [m] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, c.marketId)).limit(1);
    if (m) revalidatePath(`/market/${m.slug}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}

// value: 1 = like, -1 = dislike; sending the same value again removes the vote.
export async function voteComment(input: {
  commentId: string;
  value: 1 | -1;
}): Promise<{ ok: boolean; error?: string; myVote?: number }> {
  try {
    const u = await requireUser();
    if (input.value !== 1 && input.value !== -1) throw new Error("Bad vote");
    const [c] = await db.select().from(schema.comment).where(eq(schema.comment.id, input.commentId)).limit(1);
    if (!c) throw new Error("Not found");

    let myVote: number = input.value;
    await db.transaction(async (tx) => {
      const [cur] = await tx
        .select({ value: schema.commentVote.value })
        .from(schema.commentVote)
        .where(and(eq(schema.commentVote.commentId, input.commentId), eq(schema.commentVote.userId, u.id)))
        .for("update")
        .limit(1);
      if (cur?.value === input.value) {
        myVote = 0;
        await tx
          .delete(schema.commentVote)
          .where(and(eq(schema.commentVote.commentId, input.commentId), eq(schema.commentVote.userId, u.id)));
      } else {
        await tx
          .insert(schema.commentVote)
          .values({ commentId: input.commentId, userId: u.id, value: input.value })
          .onConflictDoUpdate({
            target: [schema.commentVote.commentId, schema.commentVote.userId],
            set: { value: input.value },
          });
      }
    });
    const [m] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, c.marketId)).limit(1);
    if (m) revalidatePath(`/market/${m.slug}`);
    return { ok: true, myVote };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Vote failed" };
  }
}



// ---------- minigames ----------

const MIN_BET_CENTS = 100; // Ɱ1
const MAX_WAGER_CENTS = 100_000_00; // Ɱ100k sanity cap

// Debit the wager, pay out on a win. Two ledger rows keep the audit trail
// readable: "… — wager ×N" then "… — won".
async function settleGame(
  tx: Tx,
  userId: string,
  betCents: number,
  leverage: number,
  won: boolean,
  mult: number,
  label: string
): Promise<number> {
  const wager = Math.round(betCents * leverage);
  if (!Number.isFinite(wager) || wager < MIN_BET_CENTS) throw new Error("Minimum bet is Ɱ1");
  if (wager > MAX_WAGER_CENTS) throw new Error("Bet too large");
  await lockUser(tx, userId);
  await credit(tx, userId, -wager, "game", null, `${label} — wager ×${leverage}`);
  let win = 0;
  if (won) {
    win = Math.round(wager * mult);
    await credit(tx, userId, win, "game", null, `${label} — won ×${mult}`);
  }
  return win - wager;
}

function checkBet(betCents: number, leverage: number) {
  const bet = Math.round(betCents);
  const lev = Math.round(leverage);
  if (!Number.isFinite(bet) || bet < MIN_BET_CENTS) throw new Error("Minimum bet is Ɱ1");
  if (!GAME_LEVERAGES.includes(lev as (typeof GAME_LEVERAGES)[number])) throw new Error("Bad leverage");
  return { bet, lev };
}

export async function playCoinFlip(input: {
  betCents: number;
  leverage: number;
  pick: "heads" | "tails";
}): Promise<{ ok: boolean; error?: string; won?: boolean; landed?: string; netCents?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    if (input.pick !== "heads" && input.pick !== "tails") throw new Error("Pick a side");
    const landed = randomInt(2) === 0 ? "heads" : "tails";
    const won = landed === input.pick;
    const netCents = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, won, COINFLIP_MULT, `Coin flip ${input.pick}→${landed}`)
    );
    revalidatePath("/games");
    return { ok: true, won, landed, netCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Flip failed" };
  }
}

export async function playDice(input: {
  betCents: number;
  leverage: number;
  over: number;
}): Promise<{ ok: boolean; error?: string; won?: boolean; roll?: number; netCents?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    const over = Math.round(input.over);
    if (over < DICE_MIN_OVER || over > DICE_MAX_OVER) throw new Error("Bad target");
    const roll = randomInt(1, 7);
    const won = roll > over;
    const mult = diceMult(over);
    const netCents = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, won, mult, `Dice >${over} → ${roll}`)
    );
    revalidatePath("/games");
    return { ok: true, won, roll, netCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Roll failed" };
  }
}

// Stop-the-timer rounds are stamped server-side with an HMAC so the measured
// time can't be forged: the token carries (user, target, issued-at); stop
// computes elapsed from the server clock, not the client's.
const TIMER_SECRET = process.env.BETTER_AUTH_SECRET ?? "monobet-dev-secret";

function signTimerRound(userId: string, targetMs: number): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, t: targetMs, i: Date.now() })).toString("base64url");
  const sig = createHmac("sha256", TIMER_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function openTimerRound(token: string, userId: string): { t: number; i: number } {
  const [payload, sig] = token.split(".");
  const good = createHmac("sha256", TIMER_SECRET).update(payload ?? "").digest("base64url");
  if (!sig || sig.length !== good.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(good)))
    throw new Error("Bad round token");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: string; t: number; i: number };
  if (data.u !== userId) throw new Error("Not your round");
  return { t: data.t, i: data.i };
}

export async function startTimerRound(input: {
  targetMs: number;
}): Promise<{ ok: boolean; error?: string; token?: string }> {
  try {
    const u = await requireUser();
    const target = Math.round(input.targetMs);
    if (!TIMER_TARGETS.includes(target as (typeof TIMER_TARGETS)[number])) throw new Error("Bad target");
    return { ok: true, token: signTimerRound(u.id, target) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Start failed" };
  }
}

export async function stopTimerRound(input: {
  token: string;
  betCents: number;
  leverage: number;
}): Promise<{ ok: boolean; error?: string; won?: boolean; elapsedMs?: number; errMs?: number; netCents?: number; mult?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    const { t: target, i: issued } = openTimerRound(input.token, u.id);
    const elapsed = Date.now() - issued;
    if (elapsed < 400) throw new Error("Stopped suspiciously fast");
    if (elapsed > target + 4000) throw new Error("Round expired — press Stop sooner");
    const err = Math.abs(elapsed - target);
    const mult = timerMult(err, target);
    const won = mult > 0;
    const netCents = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, won, mult, `Timer ${target / 1000}s off by ${err}ms`)
    );
    revalidatePath("/games");
    return { ok: true, won, elapsedMs: elapsed, errMs: err, netCents, mult };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Stop failed" };
  }
}

export async function playLimbo(input: {
  betCents: number;
  leverage: number;
  target: number;
}): Promise<{ ok: boolean; error?: string; won?: boolean; roll?: number; netCents?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    const target = Number(input.target);
    if (!Number.isFinite(target) || target < LIMBO_MIN || target > LIMBO_MAX) throw new Error("Bad target");
    // Crash point: 0.99/(1−u), clamped — win when the rocket clears the bar.
    const u1 = (randomInt(2 ** 32) + randomInt(2 ** 32) / 2 ** 32) / 2 ** 32;
    const roll = Math.min(1000, Math.max(1, 0.99 / (1 - u1)));
    const won = roll >= target;
    const netCents = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, won, target * 0.98, `Limbo ≥${target}x → ${roll.toFixed(2)}x`)
    );
    revalidatePath("/games");
    return { ok: true, won, roll: Math.round(roll * 100) / 100, netCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Limbo failed" };
  }
}

export async function playWheel(input: {
  betCents: number;
  leverage: number;
}): Promise<{ ok: boolean; error?: string; index?: number; mult?: number; netCents?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    const index = randomInt(WHEEL_SEGMENTS.length);
    const mult = WHEEL_SEGMENTS[index];
    const netCents = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, mult > 0, mult, `Wheel → ${mult}x`)
    );
    revalidatePath("/games");
    return { ok: true, index, mult, netCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Spin failed" };
  }
}

// Three reels from the weighted strip in lib/games.ts — same math both sides.
export async function playSlots(input: {
  betCents: number;
  leverage: number;
}): Promise<{ ok: boolean; error?: string; reels?: number[]; mult?: number; netCents?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    const reels = [slotDraw(randomInt(SLOT_TOTAL_WEIGHT)), slotDraw(randomInt(SLOT_TOTAL_WEIGHT)), slotDraw(randomInt(SLOT_TOTAL_WEIGHT))];
    const mult = slotPayout(reels[0], reels[1], reels[2]);
    const label = `Slots ${reels.map((i) => SLOT_SYMBOLS[i]).join(" ")}`;
    const netCents = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, mult > 0, mult, label)
    );
    revalidatePath("/games");
    return { ok: true, reels, mult, netCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Spin failed" };
  }
}

// ---------- referral ----------

// Referee gets Ɱ100 once; the referrer gets Ɱ200 per friend who joins.
// The referrer row is keyed bonus:referrer:<refereeId> so reward_once_idx
// allows unlimited referrals while still blocking the same pair twice.
export async function claimReferral(input: { ref: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const ref = input.ref.trim().toLowerCase();
    if (!/^[a-z0-9_.-]+$/.test(ref)) throw new Error("Invalid referral link");
    if (ref === (u.username ?? "").toLowerCase()) throw new Error("Can't refer yourself");
    await db.transaction(async (tx) => {
      const [used] = await tx
        .select({ id: schema.rewardClaim.id })
        .from(schema.rewardClaim)
        .where(and(eq(schema.rewardClaim.userId, u.id), eq(schema.rewardClaim.kind, "bonus:referral")))
        .limit(1);
      if (used) throw new Error("Referral already used");
      const [refUser] = await tx
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(sql`lower(${schema.user.username}) = ${ref}`)
        .limit(1);
      if (!refUser) throw new Error("Referrer not found");
      await tx.insert(schema.rewardClaim).values({ userId: u.id, kind: "bonus:referral", amountCents: REFEREE_BONUS });
      await credit(tx, u.id, REFEREE_BONUS, "bonus", null, `Referral bonus via @${ref}`);
      await tx.insert(schema.rewardClaim).values({
        userId: refUser.id,
        kind: `bonus:referrer:${u.id}`,
        amountCents: REFERRER_BONUS,
      });
      await credit(tx, refUser.id, REFERRER_BONUS, "bonus", null, `Referral: @${u.username ?? u.name} joined`);
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Referral failed" };
  }
}

// ---------- watchlist ----------

export async function toggleWatchlist(input: { marketId: string }): Promise<{ ok: boolean; error?: string; watching?: boolean }> {
  try {
    const u = await requireUser();
    const [existing] = await db
      .select()
      .from(schema.watchlist)
      .where(and(eq(schema.watchlist.userId, u.id), eq(schema.watchlist.marketId, input.marketId)))
      .limit(1);
    if (existing) {
      await db
        .delete(schema.watchlist)
        .where(and(eq(schema.watchlist.userId, u.id), eq(schema.watchlist.marketId, input.marketId)));
      return { ok: true, watching: false };
    }
    await db.insert(schema.watchlist).values({ userId: u.id, marketId: input.marketId });
    return { ok: true, watching: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

// ---------- market likes ----------

export async function toggleLike(input: { marketId: string }): Promise<{ ok: boolean; error?: string; liked?: boolean }> {
  try {
    const u = await requireUser();
    const where = and(eq(schema.marketLike.userId, u.id), eq(schema.marketLike.marketId, input.marketId));
    const [existing] = await db.select().from(schema.marketLike).where(where).limit(1);
    if (existing) {
      await db.delete(schema.marketLike).where(where);
      return { ok: true, liked: false };
    }
    await db.insert(schema.marketLike).values({ userId: u.id, marketId: input.marketId });
    return { ok: true, liked: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

// ---------- duels ----------

// A challenges B: the claim is just text both sides agreed on — settlement is
// mutual, with admins breaking disputes. Stakes escrow through the ledger.
export async function createDuel(input: {
  opponent: string;
  claim: string;
  stakeCents: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const claim = input.claim.trim();
    if (claim.length < 5) throw new Error("Describe the bet (min 5 chars)");
    if (claim.length > 200) throw new Error("Claim too long (max 200)");
    const stake = Math.round(input.stakeCents);
    if (!Number.isFinite(stake) || stake < 100) throw new Error("Minimum stake is Ɱ1");
    if (stake > 10_000_000) throw new Error("Maximum stake is Ɱ100,000");
    await db.transaction(async (tx) => {
      const [opp] = await tx
        .select({ id: schema.user.id, username: schema.user.username, balanceCents: schema.user.balanceCents })
        .from(schema.user)
        .where(sql`lower(${schema.user.username}) = lower(${input.opponent.trim()})`)
        .limit(1);
      if (!opp) throw new Error("No such user");
      if (opp.id === u.id) throw new Error("Pick someone else");
      await lockUser(tx, u.id);
      await credit(tx, u.id, -stake, "duel", null, `Duel stake vs @${opp.username}: ${claim.slice(0, 60)}`);
      await tx.insert(schema.challenge).values({ creatorId: u.id, opponentId: opp.id, claim, stakeCents: stake });
      await tx.insert(schema.ledger).values({
        userId: opp.id,
        amountCents: 0,
        balanceAfterCents: opp.balanceCents,
        kind: "notify",
        memo: `Duel invite from @${u.username ?? u.name}: ${claim.slice(0, 70)}`,
      });
    });
    revalidatePath("/duels");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Duel failed" };
  }
}

export async function respondDuel(input: {
  id: string;
  accept: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.challenge).where(eq(schema.challenge.id, input.id)).for("update").limit(1);
      if (!c || c.opponentId !== u.id) throw new Error("Not your duel");
      if (c.status !== "open") throw new Error("Already answered");
      if (input.accept) {
        await lockUser(tx, u.id);
        await credit(tx, u.id, -c.stakeCents, "duel", null, `Duel stake: ${c.claim.slice(0, 70)}`);
        await tx.update(schema.challenge).set({ status: "accepted" }).where(eq(schema.challenge.id, c.id));
      } else {
        await lockUser(tx, c.creatorId);
        await credit(tx, c.creatorId, c.stakeCents, "duel", null, `Duel declined: ${c.claim.slice(0, 60)}`);
        await tx.update(schema.challenge).set({ status: "declined" }).where(eq(schema.challenge.id, c.id));
      }
    });
    revalidatePath("/duels");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

export async function cancelDuel(input: { id: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.challenge).where(eq(schema.challenge.id, input.id)).for("update").limit(1);
      if (!c || c.creatorId !== u.id) throw new Error("Not your duel");
      if (c.status !== "open") throw new Error("Too late to cancel");
      await lockUser(tx, c.creatorId);
      await credit(tx, c.creatorId, c.stakeCents, "duel", null, `Duel cancelled: ${c.claim.slice(0, 60)}`);
      await tx.update(schema.challenge).set({ status: "cancelled" }).where(eq(schema.challenge.id, c.id));
    });
    revalidatePath("/duels");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

// One side names the winner; the other side confirms by naming the same one.
// Contradictory proposals flip the duel to 'disputed' for an admin.
export async function proposeDuelWinner(input: {
  id: string;
  winnerId: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.challenge).where(eq(schema.challenge.id, input.id)).for("update").limit(1);
      if (!c) throw new Error("Duel not found");
      if (u.id !== c.creatorId && u.id !== c.opponentId) throw new Error("Not your duel");
      if (input.winnerId !== c.creatorId && input.winnerId !== c.opponentId) throw new Error("Pick a participant");
      if (c.status !== "accepted" && c.status !== "disputed") throw new Error("Not settleable");
      if (c.pendingById && c.pendingById !== u.id) {
        // Counterparty already proposed — agreeing settles, disagreeing disputes.
        if (c.pendingWinnerId === input.winnerId) {
          await lockUser(tx, input.winnerId);
          await credit(tx, input.winnerId, c.stakeCents * 2, "duel", null, `Duel won: ${c.claim.slice(0, 60)}`);
          await tx
            .update(schema.challenge)
            .set({ status: "settled", winnerId: input.winnerId, settledAt: new Date(), pendingWinnerId: null, pendingById: null })
            .where(eq(schema.challenge.id, c.id));
        } else {
          await tx
            .update(schema.challenge)
            .set({ status: "disputed", pendingWinnerId: input.winnerId, pendingById: u.id })
            .where(eq(schema.challenge.id, c.id));
        }
      } else {
        await tx
          .update(schema.challenge)
          .set({ pendingWinnerId: input.winnerId, pendingById: u.id })
          .where(eq(schema.challenge.id, c.id));
      }
    });
    revalidatePath("/duels");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

// Admin tiebreak for disputed duels — or any stuck one. winnerId null refunds
// both stakes; a winner gets the full pot.
export async function adminSettleDuel(input: {
  id: string;
  winnerId: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    if (!isAdmin(u)) throw new Error("Admin only");
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.challenge).where(eq(schema.challenge.id, input.id)).for("update").limit(1);
      if (!c) throw new Error("Duel not found");
      if (c.status !== "accepted" && c.status !== "disputed") throw new Error("Nothing to settle");
      if (input.winnerId && input.winnerId !== c.creatorId && input.winnerId !== c.opponentId)
        throw new Error("Pick a participant");
      if (input.winnerId) {
        await lockUser(tx, input.winnerId);
        await credit(tx, input.winnerId, c.stakeCents * 2, "duel", null, `Duel won (admin): ${c.claim.slice(0, 55)}`);
      } else {
        await lockUser(tx, c.creatorId);
        await credit(tx, c.creatorId, c.stakeCents, "duel", null, `Duel refunded: ${c.claim.slice(0, 60)}`);
        await lockUser(tx, c.opponentId);
        await credit(tx, c.opponentId, c.stakeCents, "duel", null, `Duel refunded: ${c.claim.slice(0, 60)}`);
      }
      await tx
        .update(schema.challenge)
        .set({ status: "settled", winnerId: input.winnerId, settledAt: new Date(), pendingWinnerId: null, pendingById: null })
        .where(eq(schema.challenge.id, c.id));
    });
    revalidatePath("/duels");
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

// ---------- squads + notification prefs ----------

// Create-or-join by name — squad membership is open in a friend group.
export async function joinSquad(name: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const clean = name.trim();
    if (clean.length < 2) throw new Error("Squad name too short");
    if (clean.length > 24) throw new Error("Squad name too long (max 24)");
    await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(schema.squad).where(sql`lower(${schema.squad.name}) = lower(${clean})`).limit(1);
      const squadId = existing?.id ?? (await tx.insert(schema.squad).values({ name: clean, createdBy: u.id }).returning({ id: schema.squad.id }))[0].id;
      await tx.update(schema.user).set({ squadId }).where(eq(schema.user.id, u.id));
    });
    revalidatePath("/leaderboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

export async function leaveSquad(): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    await db.transaction(async (tx) => {
      await tx.update(schema.user).set({ squadId: null }).where(eq(schema.user.id, u.id));
      await tx.delete(schema.squadInvite).where(eq(schema.squadInvite.inviteeId, u.id));
    });
    revalidatePath("/leaderboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

// Invite a user by username — lands on their profile's squad card plus a
// notification. Accepting joins the squad and clears all pending invites.
export async function inviteToSquad(username: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const [me] = await db
      .select({ squadId: schema.user.squadId })
      .from(schema.user)
      .where(eq(schema.user.id, u.id))
      .limit(1);
    if (!me?.squadId) throw new Error("Join a squad first");
    const name = username.trim().replace(/^@/, "");
    const [target] = await db
      .select({ id: schema.user.id, username: schema.user.username, squadId: schema.user.squadId, balanceCents: schema.user.balanceCents })
      .from(schema.user)
      .where(sql`lower(${schema.user.username}) = lower(${name})`)
      .limit(1);
    if (!target) throw new Error("No such user");
    if (target.id === u.id) throw new Error("That's you");
    if (target.squadId === me.squadId) throw new Error("Already in your squad");
    const [sq] = await db.select().from(schema.squad).where(eq(schema.squad.id, me.squadId)).limit(1);
    await db
      .insert(schema.squadInvite)
      .values({ squadId: me.squadId, inviterId: u.id, inviteeId: target.id })
      .onConflictDoNothing();
    await db.insert(schema.ledger).values({
      userId: target.id,
      balanceAfterCents: target.balanceCents,
      kind: "notify",
      amountCents: 0,
      memo: `@${u.username ?? u.name} invited you to squad “${sq.name}” — see your profile`,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

export async function respondSquadInvite(input: {
  inviteId: string;
  accept: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    await db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(schema.squadInvite)
        .where(and(eq(schema.squadInvite.id, input.inviteId), eq(schema.squadInvite.inviteeId, u.id)))
        .limit(1)
        .for("update");
      if (!inv) throw new Error("Invite not found");
      if (input.accept) {
        await tx.update(schema.user).set({ squadId: inv.squadId }).where(eq(schema.user.id, u.id));
        await tx.delete(schema.squadInvite).where(eq(schema.squadInvite.inviteeId, u.id));
      } else {
        await tx.delete(schema.squadInvite).where(eq(schema.squadInvite.id, inv.id));
      }
    });
    revalidatePath("/leaderboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

export async function setNotifPrefs(input: {
  resolve: boolean;
  closing: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    await db
      .update(schema.user)
      .set({ notifResolve: input.resolve, notifClosing: input.closing })
      .where(eq(schema.user.id, u.id));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}
