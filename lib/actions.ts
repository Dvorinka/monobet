"use server";

import { db, schema } from "@/lib/db";
import { eq, and, sql, desc, asc, isNull } from "drizzle-orm";
import { randomInt, createHmac, timingSafeEqual } from "node:crypto";
import { GAME_LEVERAGES, COINFLIP_MULT, diceMult, DICE_MIN_OVER, DICE_MAX_OVER, TIMER_TARGETS, timerMult, LIMBO_MIN, LIMBO_MAX, WHEEL_SEGMENTS, SLOT_SYMBOLS, SLOT_TOTAL_WEIGHT, slotDraw, slotPayout, handTotal, isNatural, BJ_WIN_MULT, BJ_NATURAL_MULT, dealerFx, WALL_COOLDOWN_MS, WALL_FEE_MIN_CENTS, WALL_FEE_DEBT_PCT, WALL_CLEAR_MIN_PCT, WALL_CLEAR_MAX_PCT, WALL_SILENT_PCT, WALL_MIRACLE_PER_MILLE, VOW_CHOICES_BPS, type Persona } from "@/lib/games";
import { revalidatePath } from "next/cache";
import { requireUser, requireAdmin, isAdmin } from "@/lib/session";
import { SUPER_ADMIN_EMAIL } from "@/lib/auth";
import { yesPrice, tradeCost, sharesForSpend, qForProb } from "@/lib/lmsr";
import { loanFor, liquidationValueCents, shouldLiquidate } from "@/lib/liq";
import { accruedDebtCents, LOAN_PRESETS_CENTS, LOAN_OFFER_COUNT, LOAN_OFFER_TTL_MS, rollRateBps, DEBT_CAP_CENTS } from "@/lib/loans";
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
async function assertNotSpam(userId: string, kind: "trade" | "game" | "comment" | "loan" | "wall") {
  const limits = { trade: 60, game: 60, comment: 5, loan: 3, wall: 2 };
  const max = limits[kind];
  let n = 0;
  if (kind === "comment") {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.comment)
      .where(and(eq(schema.comment.userId, userId), sql`${schema.comment.createdAt} > now() - interval '5 minutes'`));
    n = r?.n ?? 0;
  } else if (kind === "loan") {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.ledger)
      .where(and(eq(schema.ledger.userId, userId), eq(schema.ledger.kind, "loan"), sql`${schema.ledger.createdAt} > now() - interval '1 hour'`));
    n = r?.n ?? 0;
  } else if (kind === "game") {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.ledger)
      .where(and(eq(schema.ledger.userId, userId), eq(schema.ledger.kind, "game"), sql`${schema.ledger.createdAt} > now() - interval '5 minutes'`));
    n = r?.n ?? 0;
  } else if (kind === "wall") {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.wallPrayer)
      .where(and(eq(schema.wallPrayer.userId, userId), sql`${schema.wallPrayer.createdAt} > now() - interval '5 minutes'`));
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

// Adds `addCents` of principal at `rateBps` — existing debt is accrued first
// and the rate is blended by principal so one field covers everything.
async function addDebt(tx: Tx, userId: string, addCents: number, rateBps: number, memo: string) {
  const u = await lockUser(tx, userId);
  const now = new Date();
  const cur = accruedDebtCents(u.debtCents, u.debtRateBps, u.debtSince, now);
  const total = Math.min(DEBT_CAP_CENTS, cur + Math.round(addCents));
  const blended = total <= 0 ? 0 : Math.round((cur * u.debtRateBps + Math.round(addCents) * rateBps) / total);
  await tx
    .update(schema.user)
    .set({ debtCents: total, debtRateBps: blended, debtSince: total > 0 ? now : null })
    .where(eq(schema.user.id, userId));
  await tx.insert(schema.ledger).values({
    userId,
    amountCents: 0,
    balanceAfterCents: u.balanceCents,
    kind: "debt",
    marketId: null,
    memo,
  });
}

// Short random market slug — "/market/7kx9q2mp". Unambiguous alphabet.
const SLUG_ABC = "abcdefghjkmnpqrstuvwxyz23456789";
function newSlug(len = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => SLUG_ABC[b % SLUG_ABC.length]).join("");
}

// Generate until free — collisions are ~1e-12 but cheap to rule out.
async function uniqueSlug(tx: Tx): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const s = newSlug();
    const [hit] = await tx
      .select({ id: schema.market.id })
      .from(schema.market)
      .where(eq(schema.market.slug, s))
      .limit(1);
    if (!hit) return s;
  }
  throw new Error("Could not allocate a slug");
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
  const parentResolved = sibs.some((s) => s.status === "resolved");
  await tx
    .update(schema.market)
    .set({
      status: parentResolved ? "resolved" : "cancelled",
      resolvedAt: new Date(),
    })
    .where(eq(schema.market.id, m.parentId));
  const [parent] = await tx.select().from(schema.market).where(eq(schema.market.id, m.parentId)).limit(1);
  if (parent) revalidatePath(`/market/${parent.slug}`);

  // Recurring group: the series rolls over only when it finished resolved —
  // a cancelled run stops the cadence. Options clone with fresh uniform
  // pricing; labels, images and leverage carry over.
  if (parent?.recurDays && parentResolved) {
    const nextClose = new Date((parent.closesAt?.getTime() ?? Date.now()) + parent.recurDays * 24 * 3600 * 1000);
    const nextOpen = parent.opensAt ? new Date(parent.opensAt.getTime() + parent.recurDays * 24 * 3600 * 1000) : null;
    const [clone] = await tx
      .insert(schema.market)
      .values({
        slug: await uniqueSlug(tx),
        question: parent.question,
        description: parent.description,
        context: parent.context,
        category: parent.category,
        status: "live",
        kind: "group",
        creatorId: parent.creatorId,
        b: parent.b,
        opensAt: nextOpen,
        closesAt: nextClose,
        recurDays: parent.recurDays,
        maxLeverage: parent.maxLeverage,
        imageUrl: parent.imageUrl,
      })
      .returning({ id: schema.market.id });
    const kids = sibs.length; // same option set — just reset to uniform odds
    const base = parent.question.replace(/[?？!.\s]+$/g, "");
    const originals = await tx
      .select()
      .from(schema.market)
      .where(eq(schema.market.parentId, parent.id))
      .orderBy(asc(schema.market.sortIndex));
    for (const [i, o] of originals.entries()) {
      const pi = Math.min(0.99, Math.max(0.01, 1 / kids));
      const [child] = await tx
        .insert(schema.market)
        .values({
          slug: await uniqueSlug(tx),
          question: `${base} — ${o.label ?? o.question}?`,
          description: parent.description,
          category: parent.category,
          status: "live",
          kind: "option",
          parentId: clone.id,
          label: o.label,
          imageUrl: o.imageUrl,
          sortIndex: i,
          creatorId: parent.creatorId,
          b: parent.b,
          qYes: qForProb(pi, parent.b).toFixed(6),
          qNo: "0",
          opensAt: nextOpen,
          closesAt: nextClose,
          maxLeverage: parent.maxLeverage,
        })
        .returning({ id: schema.market.id });
      await tx.insert(schema.pricePoint).values({ marketId: child.id, yesPrice: pi.toFixed(5) });
    }
  }
}

// ---------- trading ----------

// Leverage: the user posts `spend` as collateral and the house lends the rest,
// so `notional = spend × leverage` worth of shares. The loan lives on the
// position row as debtCents and is repaid out of sells/resolves/refunds.
const TRADE_LEVERAGES = [1, 2, 3, 5, 10, 25, 50, 100];

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
      if (m.opensAt && new Date(m.opensAt) > new Date()) throw new Error("Trading is not open yet");
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
        if (!Number.isFinite(spend) || spend < 100) throw new Error("Minimum trade is Ɱ 1");
        if (!TRADE_LEVERAGES.includes(leverage)) throw new Error("Bad leverage");
        if (leverage > m.maxLeverage) throw new Error(`Max leverage on this market is ${m.maxLeverage}×`);
        assertCreditLine(u, leverage);
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

// Milestone checks for claimBonus — each maps to real rows in the DB.
async function bonusMet(tx: Tx, cur: typeof schema.user.$inferSelect, check: string): Promise<boolean> {
  const one = async (q: Promise<unknown[]>) => (await q).length > 0;
  switch (check) {
    case "bet":
      return one(tx.select({ id: schema.trade.id }).from(schema.trade).where(eq(schema.trade.userId, cur.id)).limit(1));
    case "market":
      return one(tx.select({ id: schema.market.id }).from(schema.market).where(eq(schema.market.creatorId, cur.id)).limit(1));
    case "comment":
      return one(tx.select({ id: schema.comment.id }).from(schema.comment).where(eq(schema.comment.userId, cur.id)).limit(1));
    case "game":
      return one(tx.select({ id: schema.ledger.id }).from(schema.ledger).where(and(eq(schema.ledger.userId, cur.id), eq(schema.ledger.kind, "game"))).limit(1));
    case "win":
      return one(tx.select({ id: schema.ledger.id }).from(schema.ledger).where(and(eq(schema.ledger.userId, cur.id), eq(schema.ledger.kind, "game"), sql`${schema.ledger.amountCents} > 0`)).limit(1));
    case "avatar":
      return !!cur.image;
    case "watchlist":
      return one(tx.select({ userId: schema.watchlist.userId }).from(schema.watchlist).where(eq(schema.watchlist.userId, cur.id)).limit(1));
    case "like":
      return one(tx.select({ userId: schema.marketLike.userId }).from(schema.marketLike).where(eq(schema.marketLike.userId, cur.id)).limit(1));
    case "duel":
      return one(tx.select({ id: schema.challenge.id }).from(schema.challenge).where(sql`${schema.challenge.creatorId} = ${cur.id} or ${schema.challenge.opponentId} = ${cur.id}`).limit(1));
    case "squad":
      return !!cur.squadId;
    case "tenTrades": {
      const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.trade).where(eq(schema.trade.userId, cur.id));
      return (r?.n ?? 0) >= 10;
    }
    case "streak7":
      return cur.claimStreak >= 7;
    default:
      return false;
  }
}

function bonusFail(check: string): string {
  const msgs: Record<string, string> = {
    bet: "Place a bet first",
    market: "Create a market first",
    comment: "Post a comment first",
    game: "Play a casino game first",
    win: "Win a game first",
    avatar: "Set an avatar first",
    watchlist: "Watchlist a market first",
    like: "Like a market first",
    duel: "Enter a duel first",
    squad: "Join a squad first",
    tenTrades: "Place ten trades first",
    streak7: "Keep a seven-day claim streak first",
  };
  return msgs[check] ?? "Not eligible yet";
}

export async function claimBonus(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const bonus = BONUS_MAP.get(key as never);
    if (!bonus) throw new Error("Unknown reward");

    await db.transaction(async (tx) => {
      const cur = await lockUser(tx, u.id);
      const [existing] = await tx
        .select({ id: schema.rewardClaim.id })
        .from(schema.rewardClaim)
        .where(and(eq(schema.rewardClaim.userId, u.id), eq(schema.rewardClaim.kind, `bonus:${key}`)))
        .limit(1);
      if (existing) throw new Error("Already claimed");

      // Milestone bonuses are verified against real activity.
      if (bonus.check && !(await bonusMet(tx, cur, bonus.check))) throw new Error(bonusFail(bonus.check));

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
  context?: string; // background shown in the Market context card
  imageUrl?: string; // market icon — URL or data:image from the form's cell
  category: string;
  newCategory?: string;
  closesAt?: string;
  opensAt?: string; // trading blocked until then — clones roll it forward
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
    const context = (input.context ?? "").trim().slice(0, 2000);
    const b = LIQUIDITY_OPTIONS.includes(input.liquidity as 100) ? input.liquidity! : 300;
    const p = Math.min(0.97, Math.max(0.03, input.initialProb ?? 0.5));
    const description = input.description.trim();
    const recurDays = [1, 7, 14, 30].includes(input.recurDays ?? 0) ? input.recurDays! : null;
    // No explicit close on a recurring market → the first run closes one
    // period out, so "Daily" actually means closes-every-day.
    const closesAt = input.closesAt
      ? new Date(input.closesAt)
      : recurDays
        ? new Date(Date.now() + recurDays * 24 * 3600 * 1000)
        : null;
    // Scheduled open — trades reject until opens_at. Must precede the close.
    const opensAt = input.opensAt ? new Date(input.opensAt) : null;
    if (opensAt && Number.isNaN(opensAt.getTime())) throw new Error("Bad open date");
    if (opensAt && closesAt && opensAt >= closesAt) throw new Error("Open must be before close");
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
            slug: await uniqueSlug(tx),
            question,
            description,
            context,
            category,
            status: "live",
            kind: "group",
            creatorId: u.id,
            b,
            opensAt,
            closesAt,
            recurDays,
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
              slug: await uniqueSlug(tx),
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
              opensAt,
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
          slug: await uniqueSlug(tx),
          question,
          description,
          context,
          category,
          status: "live",
          creatorId: u.id,
          b,
          qYes: qForProb(p, b).toFixed(6),
          qNo: "0",
          opensAt,
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
  context?: string;
  category: string;
  imageUrl?: string;
  closesAt?: string;
  opensAt?: string;
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
        context: input.context !== undefined ? input.context.trim().slice(0, 2000) : m[0].context,
        category: input.category,
        imageUrl: input.imageUrl !== undefined ? input.imageUrl.trim() || null : m[0].imageUrl,
        closesAt: input.closesAt ? new Date(input.closesAt) : null,
        opensAt: input.opensAt ? new Date(input.opensAt) : m[0].opensAt,
        b: admin && input.b && input.b > 0 ? input.b : m[0].b,
      })
      .where(eq(schema.market.id, input.marketId));
    // Group children inherit the parent's category — keep them in sync or
    // the old category keeps phantom options after a move.
    if (m[0].kind === "group" && input.category !== m[0].category) {
      await db
        .update(schema.market)
        .set({ category: input.category })
        .where(eq(schema.market.parentId, input.marketId));
    }
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
  // Groups recur from syncGroupStatus once every option has settled.
  if (m.recurDays && !m.parentId && m.kind !== "group") {
    const nextClose = new Date((m.closesAt?.getTime() ?? Date.now()) + m.recurDays * 24 * 3600 * 1000);
    const nextOpen = m.opensAt ? new Date(m.opensAt.getTime() + m.recurDays * 24 * 3600 * 1000) : null;
    const [clone] = await tx
      .insert(schema.market)
      .values({
        slug: await uniqueSlug(tx),
        question: m.question,
        description: m.description,
        context: m.context,
        category: m.category,
        status: "live",
        kind: "binary",
        creatorId: m.creatorId,
        b: m.b,
        recurDays: m.recurDays,
        maxLeverage: m.maxLeverage,
        imageUrl: m.imageUrl,
        opensAt: nextOpen,
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
      // Community-note gate: more than NOTE_ADMIN_GATE notes means the crowd
      // is weighing in — the market creator can't self-resolve, only an admin.
      const [nc] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.communityNote)
        .where(eq(schema.communityNote.marketId, m.id));
      if ((nc?.n ?? 0) > NOTE_ADMIN_GATE && !isAdmin(u))
        throw new Error("This market has 6+ community notes — an admin must resolve it");
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

// Community resolution — the resolver (creator/admin) may declare the outcome
// at any time; once the market has closed, anyone signed in may propose. Two
// confirm votes settle it, disputes send it to admins.
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
      const closed = !!m.closesAt && m.closesAt <= new Date();
      if (!closed && !isAdmin(u) && m.creatorId !== u.id) throw new Error("Market hasn't closed yet");
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
      // Two confirms with no disputes settles the market at the proposal —
      // unless the community left enough notes to force an admin's eyes.
      const [nc] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.communityNote)
        .where(eq(schema.communityNote.marketId, m.id));
      if ((c?.n ?? 0) >= 2 && (d?.n ?? 0) === 0 && (nc?.n ?? 0) <= NOTE_ADMIN_GATE) {
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

// Permanently delete a user — FK cascades wipe sessions, positions, trades,
// comments, votes, invites, duels and rewards; their markets stay (creatorId
// goes null). Same protections as banning: not self, not the owner account.
export async function adminDeleteUser(input: { userId: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    await assertManageableUser(input.userId, admin.id);
    const [target] = await db
      .select({ role: schema.user.role })
      .from(schema.user)
      .where(eq(schema.user.id, input.userId))
      .limit(1);
    if (target?.role === "admin") throw new Error("Remove the admin role first");
    await db.delete(schema.user).where(eq(schema.user.id, input.userId));
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}

// ---------- community notes ----------

// Above this many notes on one market, only a site admin may resolve it —
// the community flagged it loud enough that creator-resolution isn't trusted.
const NOTE_ADMIN_GATE = 5;

// True when `u` may moderate notes on market `m`: site admin, the market's
// creator, or — for a group option — the parent market's creator.
async function canModerateMarket(m: { creatorId: string | null; parentId: string | null }, userId: string, admin: boolean) {
  if (admin) return true;
  if (m.creatorId === userId) return true;
  if (m.parentId) {
    const [p] = await db.select({ creatorId: schema.market.creatorId }).from(schema.market).where(eq(schema.market.id, m.parentId)).limit(1);
    if (p?.creatorId === userId) return true;
  }
  return false;
}

// Add a note to a resolvable market — binary or a group option. Stance is the
// outcome the note argues for; resolver sees these before settling.
export async function addCommunityNote(input: {
  marketId: string;
  body: string;
  stance?: "yes" | "no";
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    if (u.commentsBanned) throw new Error("You're muted");
    await assertNotSpam(u.id, "comment");
    const body = input.body.trim().slice(0, 500);
    if (body.length < 10) throw new Error("Note too short — explain the reasoning");
    const m = await db.select().from(schema.market).where(eq(schema.market.id, input.marketId)).limit(1);
    if (!m[0] || m[0].kind === "group" || !["live", "resolved"].includes(m[0].status)) throw new Error("Not a resolvable market");
    await db.insert(schema.communityNote).values({
      marketId: m[0].id,
      userId: u.id,
      body,
      stance: input.stance === "no" ? "no" : input.stance === "yes" ? "yes" : null,
    });
    const [self] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, m[0].id)).limit(1);
    if (self) revalidatePath(`/market/${self.slug}`);
    if (m[0].parentId) {
      const [p] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, m[0].parentId)).limit(1);
      if (p) revalidatePath(`/market/${p.slug}`);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Note failed" };
  }
}

// Publish/unpublish a note onto the market page — resolver-only.
export async function setNotePublished(input: { noteId: string; published: boolean }): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const [note] = await db.select().from(schema.communityNote).where(eq(schema.communityNote.id, input.noteId)).limit(1);
    if (!note) throw new Error("Note not found");
    const [m] = await db.select().from(schema.market).where(eq(schema.market.id, note.marketId)).limit(1);
    if (!m || !(await canModerateMarket(m, u.id, isAdmin(u)))) throw new Error("Only the resolver can publish notes");
    await db.update(schema.communityNote).set({ published: input.published }).where(eq(schema.communityNote.id, note.id));
    const [self] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, m.id)).limit(1);
    if (self) revalidatePath(`/market/${self.slug}`);
    if (m.parentId) {
      const [p] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, m.parentId)).limit(1);
      if (p) revalidatePath(`/market/${p.slug}`);
    }
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}

// Delete a note — the author, or the resolver moderating their market.
export async function deleteCommunityNote(input: { noteId: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const [note] = await db.select().from(schema.communityNote).where(eq(schema.communityNote.id, input.noteId)).limit(1);
    if (!note) throw new Error("Note not found");
    if (note.userId !== u.id) {
      const [m] = await db.select().from(schema.market).where(eq(schema.market.id, note.marketId)).limit(1);
      if (!m || !(await canModerateMarket(m, u.id, isAdmin(u)))) throw new Error("Not your note");
    }
    await db.delete(schema.communityNote).where(eq(schema.communityNote.id, note.id));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}

// ---------- loans ----------
// Take a house loan: cash lands immediately, debt accrues at an APR rolled
// at borrow time — you gamble on the rate you get. Repay pays debt down
// out of balance; every touch accrues first so the figure is honest.

// Loan offers are a pick-a-card gamble: the server deals three hidden APRs
// into an HMAC-signed token (same scheme as the timer rounds); the borrower
// picks a card and owes whatever rate it hid. Existing debt blocks new loans
// — repay before borrowing again.
const LOAN_SECRET = process.env.BETTER_AUTH_SECRET ?? "monobet-dev-secret";

function signLoanOffers(userId: string, amountCents: number, rates: number[]): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, a: amountCents, r: rates, i: Date.now() })).toString("base64url");
  const sig = createHmac("sha256", LOAN_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function openLoanOffers(token: string, userId: string): { a: number; r: number[] } {
  const [payload, sig] = token.split(".");
  const good = createHmac("sha256", LOAN_SECRET).update(payload ?? "").digest("base64url");
  if (!sig || sig.length !== good.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(good)))
    throw new Error("Bad offer");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: string; a: number; r: number[]; i: number };
  if (data.u !== userId) throw new Error("Not your offer");
  if (Date.now() - data.i > LOAN_OFFER_TTL_MS) throw new Error("Offers expired — deal again");
  if (!Array.isArray(data.r) || data.r.length !== LOAN_OFFER_COUNT) throw new Error("Bad offer");
  return { a: data.a, r: data.r };
}

async function assertNoDebt(userId: string) {
  const [u] = await db
    .select({ debtCents: schema.user.debtCents, debtRateBps: schema.user.debtRateBps, debtSince: schema.user.debtSince })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  if (accruedDebtCents(u?.debtCents ?? 0, u?.debtRateBps ?? 0, u?.debtSince ?? null) > 0)
    throw new Error("Repay your debt first");
}

export async function dealLoanOffers(input: { amountCents: number }): Promise<{ ok: boolean; error?: string; token?: string }> {
  try {
    const u = await requireUser();
    const amount = Math.round(input.amountCents);
    if (!LOAN_PRESETS_CENTS.includes(amount)) throw new Error("Bad loan size");
    await assertNoDebt(u.id);
    const rates = Array.from({ length: LOAN_OFFER_COUNT }, () => rollRateBps());
    return { ok: true, token: signLoanOffers(u.id, amount, rates) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Deal failed" };
  }
}

export async function takeLoan(input: { token: string; pick: number }): Promise<{ ok: boolean; error?: string; rateBps?: number; offers?: number[] }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "loan");
    const { a: amount, r: offers } = openLoanOffers(input.token, u.id);
    const pick = Math.round(input.pick);
    if (pick < 0 || pick >= offers.length) throw new Error("Pick a card");
    const rate = offers[pick];
    await db.transaction(async (tx) => {
      // Re-check on the locked row — the offers were dealt while debt-free,
      // but a levered game loss could have landed in between.
      const cur = await lockUser(tx, u.id);
      if (accruedDebtCents(cur.debtCents, cur.debtRateBps, cur.debtSince) > 0)
        throw new Error("Repay your debt first");
      await credit(tx, u.id, amount, "loan", null, `Loan @ ${(rate / 100).toFixed(1)}% APR`);
      await addDebt(tx, u.id, amount, rate, `Loan taken — ${(rate / 100).toFixed(1)}% APR`);
    });
    revalidatePath("/rewards");
    revalidatePath("/portfolio");
    return { ok: true, rateBps: rate, offers };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Loan failed" };
  }
}

export async function repayLoan(input: { amountCents?: number }): Promise<{ ok: boolean; error?: string; paidCents?: number }> {
  try {
    const u = await requireUser();
    await db.transaction(async (tx) => {
      const cur = await lockUser(tx, u.id);
      const now = new Date();
      const debt = accruedDebtCents(cur.debtCents, cur.debtRateBps, cur.debtSince, now);
      if (debt <= 0) throw new Error("No debt");
      const want = input.amountCents ? Math.round(input.amountCents) : debt;
      if (!Number.isFinite(want) || want <= 0) throw new Error("Bad amount");
      const pay = Math.min(want, debt, cur.balanceCents);
      if (pay <= 0) throw new Error("Insufficient balance");
      await credit(tx, u.id, -pay, "repay", null, "Loan repayment");
      const left = Math.max(0, debt - pay);
      await tx
        .update(schema.user)
        .set({ debtCents: left, debtRateBps: left > 0 ? cur.debtRateBps : 0, debtSince: left > 0 ? now : null })
        .where(eq(schema.user.id, u.id));
      return { paid: pay };
    });
    revalidatePath("/rewards");
    revalidatePath("/portfolio");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Repay failed" };
  }
}

// ---------- the Wall of Debts ----------
// A prayer burns a candle fee and clears a small random slice of debt — or
// nothing, when the wall stays silent. One prayer per 24h. The note is
// public; the wall remembers everyone.

export async function wallPray(input: { note?: string }): Promise<{
  ok: boolean;
  error?: string;
  silent?: boolean;
  miracle?: boolean;
  clearedCents?: number;
  feeCents?: number;
  debtCents?: number;
  nextAt?: number;
}> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "wall");
    const out = await db.transaction(async (tx) => {
      const cur = await lockUser(tx, u.id);
      const now = new Date();
      const debt = accruedDebtCents(cur.debtCents, cur.debtRateBps, cur.debtSince, now);
      if (debt <= 0) throw new Error("No debt to pray away");
      if (cur.wallPrayerAt && now.getTime() - cur.wallPrayerAt.getTime() < WALL_COOLDOWN_MS)
        throw new Error("The wall is still listening");
      const fee = Math.max(WALL_FEE_MIN_CENTS, Math.round(debt * WALL_FEE_DEBT_PCT));
      if (cur.balanceCents < fee) throw new Error(`The candle costs Ɱ ${(fee / 100).toFixed(0)}`);
      // The candle burns — the fee is gone regardless of what the wall answers.
      await credit(tx, u.id, -fee, "burn", null, "Wall candle");
      const silent = randomInt(100) < WALL_SILENT_PCT;
      const miracle = !silent && randomInt(1000) < WALL_MIRACLE_PER_MILLE;
      const cleared = silent
        ? 0
        : miracle
          ? debt
          : Math.round(debt * (WALL_CLEAR_MIN_PCT + (randomInt(1000) / 1000) * (WALL_CLEAR_MAX_PCT - WALL_CLEAR_MIN_PCT)));
      const left = Math.max(0, debt - cleared);
      await tx
        .update(schema.user)
        .set({
          debtCents: left,
          debtRateBps: left > 0 ? cur.debtRateBps : 0,
          debtSince: left > 0 ? now : null,
          wallPrayerAt: now,
        })
        .where(eq(schema.user.id, u.id));
      await tx.insert(schema.wallPrayer).values({
        userId: u.id,
        note: (input.note ?? "").slice(0, 140),
        feeCents: fee,
        clearedCents: cleared,
        miracle,
      });
      return { cleared, fee, left, silent, miracle, nextAt: now.getTime() + WALL_COOLDOWN_MS };
    });
    revalidatePath("/rewards");
    revalidatePath("/portfolio");
    return { ok: true, silent: out.silent, miracle: out.miracle, clearedCents: out.cleared, feeCents: out.fee, debtCents: out.left, nextAt: out.nextAt };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The wall didn't answer" };
  }
}

// The vow — pledge a share of every win toward the debt until it's clear.
export async function setVow(input: { bps: number }): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const bps = Math.round(input.bps);
    if (!VOW_CHOICES_BPS.includes(bps)) throw new Error("Bad vow");
    await db.update(schema.user).set({ vowBps: bps }).where(eq(schema.user.id, u.id));
    revalidatePath("/rewards");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Vow failed" };
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
    if (u.commentBanUntil && u.commentBanUntil > new Date())
      throw new Error("You are timed out from commenting");
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

export async function editComment(input: {
  commentId: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const body = input.body.trim();
    if (!body) throw new Error("Empty comment");
    if (body.length > 1000) throw new Error("Comment too long (max 1000)");
    const [c] = await db.select().from(schema.comment).where(eq(schema.comment.id, input.commentId)).limit(1);
    if (!c) throw new Error("Not found");
    if (c.userId !== u.id) throw new Error("Not yours");
    if (c.hidden) throw new Error("Hidden comments can't be edited");
    await db.update(schema.comment).set({ body }).where(eq(schema.comment.id, c.id));
    const [m] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, c.marketId)).limit(1);
    if (m) revalidatePath(`/market/${m.slug}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Edit failed" };
  }
}

// Admin comment tools: censor keeps the row but masks the body; timeout mutes
// the author for N hours; commentsBanned is the permanent variant.
export async function adminSetCommentHidden(input: {
  commentId: string;
  hidden: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const [c] = await db.select().from(schema.comment).where(eq(schema.comment.id, input.commentId)).limit(1);
    if (!c) throw new Error("Not found");
    await db.update(schema.comment).set({ hidden: input.hidden }).where(eq(schema.comment.id, c.id));
    const [m] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, c.marketId)).limit(1);
    if (m) revalidatePath(`/market/${m.slug}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function adminTimeoutComments(input: {
  userId: string;
  hours: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    await assertManageableUser(input.userId, admin.id);
    const hours = Math.min(Math.max(Math.round(input.hours), 1), 24 * 30);
    const until = hours > 0 ? new Date(Date.now() + hours * 3600_000) : null;
    await db.update(schema.user).set({ commentBanUntil: until }).where(eq(schema.user.id, input.userId));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}

// Autocomplete for squad invites — only squad-less users can be invited.
export async function searchUsers(q: string): Promise<{ username: string | null; name: string; image: string | null }[]> {
  const u = await requireUser();
  const term = q.trim().replace(/^@/, "");
  if (term.length < 1) return [];
  return db
    .select({ username: schema.user.username, name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .where(
      and(
        sql`lower(${schema.user.username}) like lower(${"%" + term.replace(/[%_]/g, "") + "%"})`,
        isNull(schema.user.squadId),
        sql`${schema.user.id} <> ${u.id}`
      )
    )
    .limit(6);
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
const RIG_PCT = 35; // rigged dealers flip ~⅓ of player wins
const MAX_WAGER_CENTS = 100_000_00; // Ɱ100k sanity cap

// Debit the collateral, pay out on a win. With leverage the house covers the
// wager — only `betCents` must be in the balance. A loss borrows the levered
// remainder onto the user's debt at a freshly rolled APR; a win pays the full
// multiple (the loan only existed to cover the stake).
async function settleGame(
  tx: Tx,
  userId: string,
  betCents: number,
  leverage: number,
  won: boolean,
  mult: number,
  label: string
): Promise<{ netCents: number; loanCents: number; skimCents: number }> {
  const wager = Math.round(betCents * leverage);
  if (!Number.isFinite(wager) || wager < MIN_BET_CENTS) throw new Error("Minimum bet is Ɱ 1");
  if (wager > MAX_WAGER_CENTS) throw new Error("Bet too large");
  const borrowed = Math.round(betCents * (leverage - 1));
  const u = await lockUser(tx, userId);
  await credit(tx, userId, -betCents, "game", null, `${label} — wager ×${leverage}`);
  let win = 0;
  let skim = 0;
  if (won) {
    win = Math.round(wager * mult);
    // Wall vow — a pledged share of every win is garnished to the debt first.
    skim = Math.min(win, await vowSkim(tx, userId, u.vowBps ?? 0, win, label));
    const take = win - skim;
    if (take > 0) await credit(tx, userId, take, "game", null, `${label} — won ×${mult}${skim ? " (vow skimmed)" : ""}`);
  }
  let loan = 0;
  if (!won && borrowed > 0) {
    const r = rollRateBps();
    loan = borrowed;
    await addDebt(tx, userId, borrowed, r, `${label} — house loan ${(borrowed / 100).toFixed(0)}Ɱ @ ${(r / 100).toFixed(1)}% APR`);
  }
  return { netCents: win - wager, loanCents: loan, skimCents: skim };
}

// Garnishes `vowBps` of a win toward accrued debt; returns the skimmed cents.
async function vowSkim(tx: Tx, userId: string, vowBps: number, winCents: number, label: string): Promise<number> {
  if (!vowBps) return 0;
  const u = await lockUser(tx, userId);
  const debt = accruedDebtCents(u.debtCents, u.debtRateBps, u.debtSince);
  if (debt <= 0) return 0;
  const skim = Math.min(Math.round(winCents * (vowBps / 10_000)), debt);
  if (skim <= 0) return 0;
  const left = Math.max(0, debt - skim);
  await tx
    .update(schema.user)
    .set({ debtCents: left, debtRateBps: left > 0 ? u.debtRateBps : 0, debtSince: left > 0 ? new Date() : null })
    .where(eq(schema.user.id, userId));
  await tx.insert(schema.ledger).values({
    userId,
    amountCents: 0,
    balanceAfterCents: u.balanceCents,
    kind: "repay",
    marketId: null,
    memo: `${label} — vow garnish ${skim / 100}Ɱ`,
  });
  return skim;
}

function checkBet(betCents: number, leverage: number) {
  const bet = Math.round(betCents);
  const lev = Math.round(leverage);
  if (!Number.isFinite(bet) || bet < MIN_BET_CENTS) throw new Error("Minimum bet is Ɱ 1");
  if (!GAME_LEVERAGES.includes(lev as (typeof GAME_LEVERAGES)[number])) throw new Error("Bad leverage");
  return { bet, lev };
}

// The house won't extend credit to a debtor — leverage locks until the debt
// (with accrued interest) is repaid. Applies to games and leveraged trades.
function assertCreditLine(u: { debtCents: number; debtRateBps: number; debtSince: Date | null }, lev: number) {
  if (lev > 1 && accruedDebtCents(u.debtCents, u.debtRateBps, u.debtSince) > 0)
    throw new Error("In debt — the house won't extend credit. Repay first.");
}

export async function playCoinFlip(input: {
  betCents: number;
  leverage: number;
  pick: "heads" | "tails";
  dealerId?: string;
}): Promise<{ ok: boolean; error?: string; won?: boolean; landed?: string; netCents?: number; dealer?: Persona; loanCents?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    assertCreditLine(u, lev);
    if (input.pick !== "heads" && input.pick !== "tails") throw new Error("Pick a side");
    let landed: "heads" | "tails" = randomInt(2) === 0 ? "heads" : "tails";
    let won = landed === input.pick;
    const dealer = await pickDealer(input.dealerId);
    // Rigged table: a share of player wins quietly flips the other way.
    if (dealerFx(dealer).rigged && won && randomInt(100) < RIG_PCT) {
      landed = landed === "heads" ? "tails" : "heads";
      won = false;
    }
    const { netCents, loanCents } = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, won, COINFLIP_MULT, `Coin flip ${input.pick}→${landed}`)
    );
    revalidatePath("/games");
    return { ok: true, won, landed, netCents, dealer, loanCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Flip failed" };
  }
}

export async function playDice(input: {
  betCents: number;
  leverage: number;
  over: number;
  dealerId?: string;
}): Promise<{ ok: boolean; error?: string; won?: boolean; roll?: number; netCents?: number; dealer?: Persona; loanCents?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    assertCreditLine(u, lev);
    const over = Math.round(input.over);
    if (over < DICE_MIN_OVER || over > DICE_MAX_OVER) throw new Error("Bad target");
    let roll = randomInt(1, 7);
    let won = roll > over;
    const mult = diceMult(over);
    const dealer = await pickDealer(input.dealerId);
    if (dealerFx(dealer).rigged && won && randomInt(100) < RIG_PCT) {
      roll = randomInt(1, over); // a losing face, still inside 1..over
      won = false;
    }
    const { netCents, loanCents } = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, won, mult, `Dice >${over} → ${roll}`)
    );
    revalidatePath("/games");
    return { ok: true, won, roll, netCents, dealer, loanCents };
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
  dealerId?: string;
}): Promise<{ ok: boolean; error?: string; won?: boolean; elapsedMs?: number; errMs?: number; netCents?: number; mult?: number; dealer?: Persona; loanCents?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    assertCreditLine(u, lev);
    const { t: target, i: issued } = openTimerRound(input.token, u.id);
    const elapsed = Date.now() - issued;
    if (elapsed < 400) throw new Error("Stopped suspiciously fast");
    if (elapsed > target + 4000) throw new Error("Round expired — press Stop sooner");
    const err = Math.abs(elapsed - target);
    const mult = timerMult(err, target);
    const won = mult > 0;
    const dealer = await pickDealer(input.dealerId);
    const { netCents, loanCents } = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, won, mult, `Timer ${target / 1000}s off by ${err}ms`)
    );
    revalidatePath("/games");
    return { ok: true, won, elapsedMs: elapsed, errMs: err, netCents, mult, dealer, loanCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Stop failed" };
  }
}

export async function playLimbo(input: {
  betCents: number;
  leverage: number;
  target: number;
  dealerId?: string;
}): Promise<{ ok: boolean; error?: string; won?: boolean; roll?: number; netCents?: number; dealer?: Persona; loanCents?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    assertCreditLine(u, lev);
    const target = Number(input.target);
    if (!Number.isFinite(target) || target < LIMBO_MIN || target > LIMBO_MAX) throw new Error("Bad target");
    // Crash point: 0.99/(1−u), clamped — win when the rocket clears the bar.
    const u1 = (randomInt(2 ** 32) + randomInt(2 ** 32) / 2 ** 32) / 2 ** 32;
    let roll = Math.min(1000, Math.max(1, 0.99 / (1 - u1)));
    let won = roll >= target;
    const dealer = await pickDealer(input.dealerId);
    if (dealerFx(dealer).rigged && won && randomInt(100) < RIG_PCT) {
      roll = Math.max(1, target * (0.3 + (randomInt(60) / 100))); // crashes under the bar
      won = false;
    }
    const { netCents, loanCents } = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, won, target * 0.98, `Limbo ≥${target}x → ${roll.toFixed(2)}x`)
    );
    revalidatePath("/games");
    return { ok: true, won, roll: Math.round(roll * 100) / 100, netCents, dealer, loanCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Limbo failed" };
  }
}

export async function playWheel(input: {
  betCents: number;
  leverage: number;
  dealerId?: string;
}): Promise<{ ok: boolean; error?: string; index?: number; mult?: number; netCents?: number; dealer?: Persona; loanCents?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    assertCreditLine(u, lev);
    let index = randomInt(WHEEL_SEGMENTS.length);
    let mult = WHEEL_SEGMENTS[index];
    const dealer = await pickDealer(input.dealerId);
    if (dealerFx(dealer).rigged && mult > 0 && randomInt(100) < RIG_PCT) {
      const zeros = WHEEL_SEGMENTS.map((m, i) => (m === 0 ? i : -1)).filter((i) => i >= 0);
      index = zeros[randomInt(zeros.length)];
      mult = 0;
    }
    const { netCents, loanCents } = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, mult > 0, mult, `Wheel → ${mult}x`)
    );
    revalidatePath("/games");
    return { ok: true, index, mult, netCents, dealer, loanCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Spin failed" };
  }
}

// Three reels from the weighted strip in lib/games.ts — same math both sides.
export async function playSlots(input: {
  betCents: number;
  leverage: number;
  dealerId?: string;
}): Promise<{ ok: boolean; error?: string; reels?: number[]; mult?: number; netCents?: number; dealer?: Persona; loanCents?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    assertCreditLine(u, lev);
    const reels = [slotDraw(randomInt(SLOT_TOTAL_WEIGHT)), slotDraw(randomInt(SLOT_TOTAL_WEIGHT)), slotDraw(randomInt(SLOT_TOTAL_WEIGHT))];
    let mult = slotPayout(reels[0], reels[1], reels[2]);
    const dealer = await pickDealer(input.dealerId);
    if (dealerFx(dealer).rigged && mult > 0 && randomInt(100) < RIG_PCT) {
      // Re-deal until a dead spin — reels visibly miss.
      for (let i = 0; i < 40 && mult > 0; i++) {
        reels[0] = slotDraw(randomInt(SLOT_TOTAL_WEIGHT));
        reels[1] = slotDraw(randomInt(SLOT_TOTAL_WEIGHT));
        reels[2] = slotDraw(randomInt(SLOT_TOTAL_WEIGHT));
        mult = slotPayout(reels[0], reels[1], reels[2]);
      }
      if (mult > 0) { reels[2] = (reels[0] + 1) % SLOT_SYMBOLS.length; mult = slotPayout(reels[0], reels[1], reels[2]); }
    }
    const label = `Slots ${reels.map((i) => SLOT_SYMBOLS[i]).join(" ")}`;
    const { netCents, loanCents } = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, mult > 0, mult, label)
    );
    revalidatePath("/games");
    return { ok: true, reels, mult, netCents, dealer, loanCents };
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

// ---------- market likes (heart also drives the watchlist) ----------

export async function toggleLike(input: { marketId: string }): Promise<{ ok: boolean; error?: string; liked?: boolean }> {
  try {
    const u = await requireUser();
    const where = and(eq(schema.marketLike.userId, u.id), eq(schema.marketLike.marketId, input.marketId));
    const watch = and(eq(schema.watchlist.userId, u.id), eq(schema.watchlist.marketId, input.marketId));
    const [existing] = await db.select().from(schema.marketLike).where(where).limit(1);
    if (existing) {
      // Unliking also unwatches — the heart is the single like+watch gesture.
      await db.delete(schema.marketLike).where(where);
      await db.delete(schema.watchlist).where(watch);
      return { ok: true, liked: false };
    }
    await db.insert(schema.marketLike).values({ userId: u.id, marketId: input.marketId });
    await db.insert(schema.watchlist).values({ userId: u.id, marketId: input.marketId }).onConflictDoNothing();
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
    if (!Number.isFinite(stake) || stake < 100) throw new Error("Minimum stake is Ɱ 1");
    if (stake > 10_000_000) throw new Error("Maximum stake is Ɱ 100,000");
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

// ---------- blackjack ----------
// Interactive round: the shoe and both hands live on blackjack_round so the
// client only ever asks "hit"/"stand". Collateral is charged at deal; a loss
// parks the levered remainder on house debt like every other game.

const BJ_FALLBACK_DEALER: Persona = { name: "The House", avatar: "", quipWin: "The house always collects.", quipLose: "Well played." };
const BJ_ROUND_TTL_MS = 60 * 60_000; // abandoned hands settle as a push

// One active dealer fronts each round of every minigame — the player picks
// theirs; absent or invalid picks fall back to a random active persona.
// Blackjack keeps it on the round row, instant games return it in the result.
async function pickDealer(dealerId?: string): Promise<Persona> {
  const dealers = await db.select().from(schema.dealerPersona).where(eq(schema.dealerPersona.active, true));
  const picked = dealerId ? dealers.find((d) => d.id === dealerId) : null;
  const d = picked ?? (dealers.length > 0 ? dealers[randomInt(dealers.length)] : null);
  return d ? { id: d.id, name: d.name, avatar: d.avatar, quipWin: d.quipWin, quipLose: d.quipLose } : BJ_FALLBACK_DEALER;
}

function shuffledShoe(): number[] {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// Settle a round: credit winnings / park levered loss on debt / refund push.
// Returns the player's net cents for the result flash.
async function settleBlackjack(
  tx: Tx,
  round: { id: string; userId: string; betCents: number; leverage: number },
  result: "win" | "lose" | "push" | "blackjack",
  dealerName: string
): Promise<{ net: number; loanCents: number }> {
  const wager = Math.round(round.betCents * round.leverage);
  const borrowed = Math.round(round.betCents * (round.leverage - 1));
  const label = `Blackjack vs ${dealerName}`;
  const u = await lockUser(tx, round.userId);
  let net: number;
  let loan = 0;
  if (result === "win" || result === "blackjack") {
    const mult = result === "blackjack" ? BJ_NATURAL_MULT : BJ_WIN_MULT;
    const win = Math.round(wager * mult);
    const skim = Math.min(win, await vowSkim(tx, round.userId, u.vowBps ?? 0, win, label));
    const take = win - skim;
    if (take > 0) await credit(tx, round.userId, take, "game", null, `${label} — ${result === "blackjack" ? "natural 21" : "won"} ×${mult}${skim ? " (vow skimmed)" : ""}`);
    net = win - wager;
  } else if (result === "push") {
    await credit(tx, round.userId, round.betCents, "game", null, `${label} — push, stake back`);
    net = 0;
  } else {
    if (borrowed > 0) {
      const r = rollRateBps();
      loan = borrowed;
      await addDebt(tx, round.userId, borrowed, r, `${label} — house loan ${(borrowed / 100).toFixed(0)}Ɱ @ ${(r / 100).toFixed(1)}% APR`);
    }
    net = -wager;
  }
  await tx
    .update(schema.blackjackRound)
    .set({ status: "settled", result, netCents: net, settledAt: new Date(), loanCents: loan })
    .where(eq(schema.blackjackRound.id, round.id));
  return { net, loanCents: loan };
}

type BjState = {
  roundId: string;
  player: number[];
  dealer: number[]; // during play only the up-card is real to the client
  dealerHidden: boolean;
  playerTotal: number;
  dealerTotal: number | null;
  persona: Persona;
  status: string;
  result?: string | null;
  netCents?: number | null;
  loanCents?: number;
};

function bjState(r: { id: string; player: number[]; dealer: number[]; persona: Persona; status: string; result: string | null; netCents: number | null; loanCents?: number }, hideDealer: boolean): BjState {
  const p = handTotal(r.player);
  const d = handTotal(r.dealer);
  return {
    roundId: r.id,
    player: r.player,
    dealer: hideDealer ? r.dealer.slice(0, 1) : r.dealer,
    dealerHidden: hideDealer,
    playerTotal: p.total,
    dealerTotal: hideDealer ? null : d.total,
    persona: r.persona,
    status: r.status,
    result: r.result,
    netCents: r.netCents,
    loanCents: r.loanCents ?? 0,
  };
}

export async function blackjackDeal(input: {
  betCents: number;
  leverage: number;
  dealerId?: string;
}): Promise<{ ok: boolean; error?: string; state?: BjState }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    assertCreditLine(u, lev);
    const persona = await pickDealer(input.dealerId);
    const deck = shuffledShoe();
    const player = [deck.pop()!, deck.pop()!];
    const dealer = [deck.pop()!, deck.pop()!];
    let state!: BjState;
    await db.transaction(async (tx) => {
      await lockUser(tx, u.id);
      // Collateral leaves the balance up front so a slow hand can't double-spend it.
      await credit(tx, u.id, -bet, "game", null, `Blackjack vs ${persona.name} — wager ×${lev}`);
      const [round] = await tx
        .insert(schema.blackjackRound)
        .values({ userId: u.id, betCents: bet, leverage: lev, deck, player, dealer, persona })
        .returning();
      const pNat = isNatural(player);
      const dNat = isNatural(dealer);
      if (pNat || dNat) {
        const result = pNat && dNat ? "push" : pNat ? "blackjack" : "lose";
        const { net, loanCents } = await settleBlackjack(tx, round, result, persona.name);
        state = bjState({ ...round, status: "settled", result, netCents: net, loanCents }, false);
      } else {
        state = bjState(round, true);
      }
    });
    revalidatePath("/games");
    return { ok: true, state };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Deal failed" };
  }
}

// Loads + locks a live round owned by the user; stale hands push-refund.
async function lockRound(tx: Tx, roundId: string, userId: string) {
  const [r] = await tx.select().from(schema.blackjackRound).where(eq(schema.blackjackRound.id, roundId)).for("update").limit(1);
  if (!r || r.userId !== userId) throw new Error("Round not found");
  if (r.status !== "playing") throw new Error("Hand already settled");
  if (Date.now() - r.createdAt.getTime() > BJ_ROUND_TTL_MS) {
    await settleBlackjack(tx, r, "push", r.persona.name);
    throw new Error("Hand timed out — stake refunded");
  }
  return r;
}

export async function blackjackHit(input: { roundId: string }): Promise<{ ok: boolean; error?: string; state?: BjState }> {
  try {
    const u = await requireUser();
    let state!: BjState;
    await db.transaction(async (tx) => {
      const r = await lockRound(tx, input.roundId, u.id);
      const deck = [...r.deck];
      const card = deck.pop()!;
      const player = [...r.player, card];
      await tx.update(schema.blackjackRound).set({ deck, player }).where(eq(schema.blackjackRound.id, r.id));
      if (handTotal(player).total > 21) {
        const { net, loanCents } = await settleBlackjack(tx, r, "lose", r.persona.name);
        state = bjState({ ...r, player, status: "settled", result: "lose", netCents: net, loanCents }, false);
      } else {
        state = bjState({ ...r, player }, true);
      }
    });
    revalidatePath("/games");
    return { ok: true, state };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Hit failed" };
  }
}

export async function blackjackStand(input: { roundId: string }): Promise<{ ok: boolean; error?: string; state?: BjState }> {
  try {
    const u = await requireUser();
    let state!: BjState;
    await db.transaction(async (tx) => {
      const r = await lockRound(tx, input.roundId, u.id);
      const deck = [...r.deck];
      const dealer = [...r.dealer];
      while (handTotal(dealer).total < 17) dealer.push(deck.pop()!);
      const p = handTotal(r.player).total;
      const d = handTotal(dealer).total;
      const result = d > 21 || p > d ? "win" : p === d ? "push" : "lose";
      const { net, loanCents } = await settleBlackjack(tx, r, result, r.persona.name);
      await tx.update(schema.blackjackRound).set({ deck, dealer }).where(eq(schema.blackjackRound.id, r.id));
      state = bjState({ ...r, dealer, status: "settled", result, netCents: net, loanCents }, false);
    });
    revalidatePath("/games");
    return { ok: true, state };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Stand failed" };
  }
}

// ---------- dealer personas (admin) ----------

export async function adminUpsertDealer(input: {
  id?: string;
  name: string;
  avatar: string;
  quipWin?: string;
  quipLose?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const name = input.name.trim().slice(0, 40);
    if (!name) throw new Error("Name required");
    // Avatar: an uploaded image (data URI or URL — same rules as market icons)
    // or a short monogram when no picture is set.
    const av = input.avatar.trim();
    const isImg =
      /^data:image\/(jpeg|png|webp);base64,/.test(av) ||
      /^data:image\/svg\+xml[;,]/.test(av) ||
      /^(https?:\/\/|\/)\S+$/.test(av);
    if (av && !isImg && av.length > 8) throw new Error("Avatar must be an image or ≤8 characters");
    if (isImg && av.length > 450_000) throw new Error("Image too large");
    const avatar = isImg ? av : av.slice(0, 8);
    const vals = { name, avatar, quipWin: (input.quipWin ?? "").trim().slice(0, 140), quipLose: (input.quipLose ?? "").trim().slice(0, 140) };
    if (input.id) {
      await db.update(schema.dealerPersona).set(vals).where(eq(schema.dealerPersona.id, input.id));
    } else {
      await db.insert(schema.dealerPersona).values(vals);
    }
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

export async function adminDeleteDealer(input: { id: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    await db.delete(schema.dealerPersona).where(eq(schema.dealerPersona.id, input.id));
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}

export async function adminToggleDealer(input: { id: string; active: boolean }): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    await db.update(schema.dealerPersona).set({ active: input.active }).where(eq(schema.dealerPersona.id, input.id));
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}
