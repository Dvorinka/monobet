"use server";

import { db, schema } from "@/lib/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireUser, requireAdmin, isAdmin } from "@/lib/session";
import { yesPrice, tradeCost, sharesForSpend, qForProb } from "@/lib/lmsr";
import { marketYesPrice, getMarketBetCount } from "@/lib/queries";
import {
  DAILY_AMOUNT,
  DAILY_COOLDOWN_MS,
  WEEKLY_AMOUNT,
  WEEKLY_COOLDOWN_MS,
  AD_AMOUNT,
  AD_COOLDOWN_MS,
  BONUS_MAP,
} from "@/lib/rewards";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
      if (m.kind === "group") throw new Error("Trade one of this market's options");
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

export async function claimDaily(): Promise<{ ok: boolean; error?: string; amount?: number; retryInH?: number }> {
  try {
    const u = await requireUser();
    await db.transaction(async (tx) => {
      const user = await lockUser(tx, u.id);
      const last = user.lastClaimAt ? new Date(user.lastClaimAt).getTime() : 0;
      const wait = DAILY_COOLDOWN_MS - (Date.now() - last);
      if (wait > 0) {
        const err = new Error("cooldown") as Error & { retryInH: number };
        err.retryInH = Math.ceil(wait / 3600000);
        throw err;
      }
      await tx.update(schema.user).set({ lastClaimAt: new Date() }).where(eq(schema.user.id, u.id));
      return credit(tx, u.id, DAILY_AMOUNT, "claim", null, "Daily faucet");
    });
    revalidatePath("/");
    return { ok: true, amount: DAILY_AMOUNT };
  } catch (e) {
    const h = (e as { retryInH?: number }).retryInH;
    return { ok: false, error: e instanceof Error ? e.message : "Claim failed", retryInH: h };
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
  category: string;
  newCategory?: string;
  closesAt?: string;
  initialProb?: number;
  liquidity?: number;
  outcomes?: string[];
  optionProbs?: number[]; // per-option opening odds in %, parallel to outcomes
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

    // Options may carry an image: "Democratic Party | https://…/logo.png"
    const parsed = (input.outcomes ?? [])
      .map((o) => o.trim())
      .filter(Boolean)
      .map((line) => {
        const [label, url] = line.split("|").map((s) => s.trim());
        if (url && !/^(https?:\/\/|\/)\S+$/.test(url)) throw new Error(`Bad image URL for "${label}"`);
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
    if (input.imageUrl && !/^(https?:\/\/|\/)\S+$/.test(input.imageUrl.trim())) throw new Error("Bad image URL");

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

export async function resolveMarket(input: {
  marketId: string;
  outcome: "yes" | "no";
}): Promise<{ ok: boolean; error?: string; paidOut?: number }> {
  try {
    const u = await requireUser();
    let paidOut = 0;
    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, input.marketId);
      if (!isAdmin(u) && m.creatorId !== u.id) throw new Error("Only the creator or an admin can resolve");
      if (m.kind === "group") throw new Error("Resolve the group's options instead");
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
      await syncGroupStatus(tx, m);
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
            const refund = Math.round((toNum(p.yesShares) * py + toNum(p.noShares) * (1 - py)) * 100);
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
        const refund = Math.round((toNum(p.yesShares) * py + toNum(p.noShares) * (1 - py)) * 100);
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
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const body = input.body.trim();
    if (!body) throw new Error("Empty comment");
    if (body.length > 1000) throw new Error("Comment too long (max 1000)");
    const image = input.image ?? null;
    if (image) {
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) throw new Error("Bad image format");
      if (image.length > 450_000) throw new Error("Image too large");
    }
    await db.insert(schema.comment).values({ marketId: input.marketId, userId: u.id, body, imageUrl: image });
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


