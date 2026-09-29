import { db, schema } from "@/lib/db";
import { eq, desc, asc, and, ilike, or, sql, inArray, isNull } from "drizzle-orm";
import { yesPrice } from "@/lib/lmsr";
import type { MarketStatus } from "@/lib/db/schema";

export type MarketRow = typeof schema.market.$inferSelect;

export function marketYesPrice(m: MarketRow): number {
  return yesPrice(Number(m.qYes), Number(m.qNo), m.b);
}

export async function listCategories() {
  const rows = await db
    .select()
    .from(schema.category)
    .orderBy(asc(schema.category.sortIndex), asc(schema.category.createdAt));
  return rows.map((r) => r.name);
}

// Categories with their market count — for the admin manager (deleting is
// only allowed when a category is empty).
export async function listCategoryRows() {
  const rows = await db
    .select({
      name: schema.category.name,
      markets: sql<number>`(select count(*)::int from ${schema.market} where ${schema.market.category} = ${schema.category.name})`,
    })
    .from(schema.category)
    .orderBy(asc(schema.category.sortIndex), asc(schema.category.createdAt));
  return rows;
}

export async function listMarkets(opts: {
  category?: string;
  q?: string;
  sort?: string;
  status?: MarketStatus;
  includePendingForUser?: string;
  includeOptions?: boolean;
}) {
  const { category, q, sort, status = "live" } = opts;
  // Only top-level markets — group options surface through their parent.
  // Admin passes includeOptions to reach every resolvable market.
  const conds = opts.includeOptions ? [] : [isNull(schema.market.parentId)];
  if (opts.includePendingForUser) {
    conds.push(
      or(
        eq(schema.market.status, status),
        and(eq(schema.market.status, "pending"), eq(schema.market.creatorId, opts.includePendingForUser))
      )!
    );
  } else {
    conds.push(eq(schema.market.status, status));
  }
  if (category && category !== "all" && category !== "trending" && category !== "new") {
    conds.push(eq(schema.market.category, category));
  }
  if (q) conds.push(or(ilike(schema.market.question, `%${q}%`), ilike(schema.market.description, `%${q}%`))!);

  const order =
    sort === "new" || category === "new"
      ? [desc(schema.market.createdAt)]
      : [desc(schema.market.volumeCents), desc(schema.market.createdAt)];

  return db.select().from(schema.market).where(and(...conds)).orderBy(...order).limit(100);
}

export async function getMarketBySlug(slug: string) {
  const rows = await db.select().from(schema.market).where(eq(schema.market.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function getMarketById(id: string) {
  const rows = await db.select().from(schema.market).where(eq(schema.market.id, id)).limit(1);
  return rows[0] ?? null;
}

// Options of a multi-outcome group, in creation order.
export async function getGroupOptions(parentId: string) {
  return db
    .select()
    .from(schema.market)
    .where(eq(schema.market.parentId, parentId))
    .orderBy(asc(schema.market.sortIndex), asc(schema.market.createdAt), asc(schema.market.id));
}

// Batch: children for a set of group ids, grouped in JS. Avoids N+1 on the grid.
export async function getGroupOptionsFor(parentIds: string[]) {
  const map = new Map<string, MarketRow[]>();
  if (parentIds.length === 0) return map;
  const rows = await db
    .select()
    .from(schema.market)
    .where(inArray(schema.market.parentId, parentIds))
    .orderBy(asc(schema.market.sortIndex), asc(schema.market.createdAt), asc(schema.market.id));
  for (const r of rows) {
    const arr = map.get(r.parentId!) ?? [];
    arr.push(r);
    map.set(r.parentId!, arr);
  }
  return map;
}

// Latest trades across all options of a group.
export async function getGroupTrades(parentId: string, limit = 25) {
  return db
    .select({
      id: schema.trade.id,
      side: schema.trade.side,
      outcome: schema.trade.outcome,
      shares: schema.trade.shares,
      amountCents: schema.trade.amountCents,
      createdAt: schema.trade.createdAt,
      username: schema.user.username,
      name: schema.user.name,
      label: schema.market.label,
    })
    .from(schema.trade)
    .innerJoin(schema.user, eq(schema.trade.userId, schema.user.id))
    .innerJoin(schema.market, eq(schema.trade.marketId, schema.market.id))
    .where(eq(schema.market.parentId, parentId))
    .orderBy(desc(schema.trade.createdAt))
    .limit(limit);
}

export async function getPriceHistory(marketId: string, since?: Date) {
  const conds = [eq(schema.pricePoint.marketId, marketId)];
  if (since) conds.push(sql`${schema.pricePoint.createdAt} >= ${since}`);
  return db
    .select({ t: schema.pricePoint.createdAt, p: schema.pricePoint.yesPrice })
    .from(schema.pricePoint)
    .where(and(...conds))
    .orderBy(asc(schema.pricePoint.createdAt));
}

export async function getRecentTrades(marketId: string, limit = 25) {
  return db
    .select({
      id: schema.trade.id,
      side: schema.trade.side,
      outcome: schema.trade.outcome,
      shares: schema.trade.shares,
      amountCents: schema.trade.amountCents,
      createdAt: schema.trade.createdAt,
      username: schema.user.username,
      name: schema.user.name,
    })
    .from(schema.trade)
    .innerJoin(schema.user, eq(schema.trade.userId, schema.user.id))
    .where(eq(schema.trade.marketId, marketId))
    .orderBy(desc(schema.trade.createdAt))
    .limit(limit);
}

export async function getComments(marketId: string, viewerId?: string) {
  const rows = await db
    .select({
      id: schema.comment.id,
      body: schema.comment.body,
      imageUrl: schema.comment.imageUrl,
      createdAt: schema.comment.createdAt,
      userId: schema.comment.userId,
      username: schema.user.username,
      name: schema.user.name,
      image: schema.user.image,
      likes: sql<number>`coalesce((select count(*)::int from ${schema.commentVote} where ${schema.commentVote.commentId} = ${schema.comment.id} and ${schema.commentVote.value} = 1), 0)`,
      dislikes: sql<number>`coalesce((select count(*)::int from ${schema.commentVote} where ${schema.commentVote.commentId} = ${schema.comment.id} and ${schema.commentVote.value} = -1), 0)`,
      myVote: viewerId
        ? sql<number>`coalesce((select ${schema.commentVote.value} from ${schema.commentVote} where ${schema.commentVote.commentId} = ${schema.comment.id} and ${schema.commentVote.userId} = ${viewerId}), 0)`
        : sql<number>`0`,
    })
    .from(schema.comment)
    .innerJoin(schema.user, eq(schema.comment.userId, schema.user.id))
    .where(eq(schema.comment.marketId, marketId))
    .orderBy(asc(schema.comment.createdAt))
    .limit(200);
  return rows;
}

export async function getUserPosition(marketId: string, userId: string) {
  const rows = await db
    .select()
    .from(schema.position)
    .where(and(eq(schema.position.marketId, marketId), eq(schema.position.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export type PositionRow = {
  market: MarketRow;
  yesShares: number;
  noShares: number;
  valueCents: number;
  debtCents: number;
};

export async function getUserPositions(userId: string): Promise<PositionRow[]> {
  const rows = await db
    .select({ position: schema.position, market: schema.market })
    .from(schema.position)
    .innerJoin(schema.market, eq(schema.position.marketId, schema.market.id))
    .where(eq(schema.position.userId, userId));
  return rows
    .map(({ position: p, market: m }) => {
      const y = Number(p.yesShares);
      const n = Number(p.noShares);
      const py = marketYesPrice(m);
      // Resolved markets price winning shares at 1, losing at 0. Leveraged
      // positions report equity (value − outstanding loan), floored at zero.
      const grossCents =
        m.status === "resolved"
          ? Math.round((m.outcome === "yes" ? y : n) * 100)
          : Math.round((y * py + n * (1 - py)) * 100);
      return { market: m, yesShares: y, noShares: n, valueCents: Math.max(0, grossCents - p.debtCents), debtCents: p.debtCents };
    })
    .filter((r) => r.yesShares > 0.0001 || r.noShares > 0.0001);
}

export async function getUserTrades(userId: string, limit = 50) {
  return db
    .select({
      trade: schema.trade,
      question: schema.market.question,
      slug: schema.market.slug,
    })
    .from(schema.trade)
    .innerJoin(schema.market, eq(schema.trade.marketId, schema.market.id))
    .where(eq(schema.trade.userId, userId))
    .orderBy(desc(schema.trade.createdAt))
    .limit(limit);
}

export async function getUserLedger(userId: string, limit = 50) {
  return db
    .select()
    .from(schema.ledger)
    .where(eq(schema.ledger.userId, userId))
    .orderBy(desc(schema.ledger.createdAt))
    .limit(limit);
}

export async function getLeaderboard() {
  // ponytail: JS aggregation; user count is a friend group, not a city.
  const users = await db
    .select({
      id: schema.user.id,
      username: schema.user.username,
      name: schema.user.name,
      image: schema.user.image,
      balanceCents: schema.user.balanceCents,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user);
  const positions = await db
    .select({ position: schema.position, market: schema.market })
    .from(schema.position)
    .innerJoin(schema.market, eq(schema.position.marketId, schema.market.id));

  const valueByUser = new Map<string, number>();
  for (const { position: p, market: m } of positions) {
    const py = marketYesPrice(m);
    const gross =
      m.status === "resolved"
        ? Number(m.outcome === "yes" ? p.yesShares : p.noShares) * 100
        : (Number(p.yesShares) * py + Number(p.noShares) * (1 - py)) * 100;
    // Leveraged positions count equity only — the loan isn't theirs.
    valueByUser.set(p.userId, (valueByUser.get(p.userId) ?? 0) + Math.max(0, gross - p.debtCents));
  }

  return users
    .map((u) => ({
      ...u,
      portfolioCents: Math.round(valueByUser.get(u.id) ?? 0),
      netWorthCents: u.balanceCents + Math.round(valueByUser.get(u.id) ?? 0),
    }))
    .sort((a, b) => b.netWorthCents - a.netWorthCents);
}

export async function getPendingMarkets() {
  return db
    .select({ market: schema.market, username: schema.user.username })
    .from(schema.market)
    .leftJoin(schema.user, eq(schema.market.creatorId, schema.user.id))
    .where(eq(schema.market.status, "pending"))
    .orderBy(asc(schema.market.createdAt));
}

export async function getAllUsers() {
  return db
    .select({
      id: schema.user.id,
      username: schema.user.username,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.user.role,
      balanceCents: schema.user.balanceCents,
      bannedAt: schema.user.bannedAt,
      commentsBanned: schema.user.commentsBanned,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .orderBy(asc(schema.user.createdAt));
}

// Timestamped price history for every option of a group — feeds the
// multi-line chart on group pages. One query, grouped in JS.
export async function getGroupHistories(marketIds: string[]) {
  const map = new Map<string, { t: string; p: number }[]>();
  if (marketIds.length === 0) return map;
  const rows = await db
    .select({ marketId: schema.pricePoint.marketId, p: schema.pricePoint.yesPrice, t: schema.pricePoint.createdAt })
    .from(schema.pricePoint)
    .where(inArray(schema.pricePoint.marketId, marketIds))
    .orderBy(asc(schema.pricePoint.createdAt));
  for (const r of rows) {
    const arr = map.get(r.marketId) ?? [];
    arr.push({ t: r.t.toISOString(), p: Number(r.p) });
    map.set(r.marketId, arr);
  }
  return map;
}

// Last ~40 price points per market, for card sparklines. One query, grouped in JS.
export async function getSparklines(marketIds: string[]) {
  const map = new Map<string, number[]>();
  if (marketIds.length === 0) return map;
  const rows = await db
    .select({ marketId: schema.pricePoint.marketId, p: schema.pricePoint.yesPrice, t: schema.pricePoint.createdAt })
    .from(schema.pricePoint)
    .where(inArray(schema.pricePoint.marketId, marketIds))
    .orderBy(asc(schema.pricePoint.createdAt));
  for (const r of rows) {
    const arr = map.get(r.marketId) ?? [];
    arr.push(Number(r.p));
    if (arr.length > 40) arr.shift();
    map.set(r.marketId, arr);
  }
  return map;
}

// Real placed bets on a market — or, for a group, across all its options.
// Used to gate creator self-deletion ("no bets yet").
export async function getMarketBetCount(marketId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.trade)
    .innerJoin(schema.market, eq(schema.trade.marketId, schema.market.id))
    .where(sql`${schema.market.id} = ${marketId} OR ${schema.market.parentId} = ${marketId}`);
  return r?.n ?? 0;
}

export async function getCommentCount(marketIds: string[]) {
  if (marketIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ marketId: schema.comment.marketId, count: sql<number>`count(*)::int` })
    .from(schema.comment)
    .where(inArray(schema.comment.marketId, marketIds))
    .groupBy(schema.comment.marketId);
  return new Map(rows.map((r) => [r.marketId, r.count]));
}

// Latest trades across all markets — feeds the homepage ticker.
export async function getGlobalTrades(limit = 14) {
  return db
    .select({
      id: schema.trade.id,
      side: schema.trade.side,
      outcome: schema.trade.outcome,
      amountCents: schema.trade.amountCents,
      createdAt: schema.trade.createdAt,
      username: schema.user.username,
      name: schema.user.name,
      slug: schema.market.slug,
      question: schema.market.question,
    })
    .from(schema.trade)
    .innerJoin(schema.user, eq(schema.trade.userId, schema.user.id))
    .innerJoin(schema.market, eq(schema.trade.marketId, schema.market.id))
    .orderBy(desc(schema.trade.createdAt))
    .limit(limit);
}

export async function getSiteStats() {
  const [users] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.user);
  const [vol] = await db
    .select({ n: sql<number>`coalesce(sum(${schema.market.volumeCents}),0)::int` })
    .from(schema.market);
  const [trades] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.trade);
  return { users: users?.n ?? 0, volumeCents: vol?.n ?? 0, trades: trades?.n ?? 0 };
}

// Same-category markets excluding the given one — "More markets" rail.
export async function getRelatedMarkets(marketId: string, category: string, limit = 3) {
  return db
    .select()
    .from(schema.market)
    .where(and(eq(schema.market.category, category), eq(schema.market.status, "live"), isNull(schema.market.parentId), sql`${schema.market.id} <> ${marketId}`))
    .orderBy(desc(schema.market.volumeCents))
    .limit(limit);
}

// Rewards state for /rewards: recurring cooldowns, claimed bonuses, and
// milestone eligibility in one round trip per user.
export async function getRewardsState(userId: string) {
  const claims = await db
    .select({ kind: schema.rewardClaim.kind, createdAt: schema.rewardClaim.createdAt })
    .from(schema.rewardClaim)
    .where(eq(schema.rewardClaim.userId, userId))
    .orderBy(desc(schema.rewardClaim.createdAt));
  const [bet] = await db.select({ id: schema.trade.id }).from(schema.trade).where(eq(schema.trade.userId, userId)).limit(1);
  const [mk] = await db.select({ id: schema.market.id }).from(schema.market).where(eq(schema.market.creatorId, userId)).limit(1);
  const [cm] = await db.select({ id: schema.comment.id }).from(schema.comment).where(eq(schema.comment.userId, userId)).limit(1);
  return {
    claimed: new Set(claims.map((c) => c.kind)),
    lastWeekly: claims.find((c) => c.kind === "weekly")?.createdAt ?? null,
    lastAd: claims.find((c) => c.kind === "ad")?.createdAt ?? null,
    eligible: { bet: !!bet, market: !!mk, comment: !!cm },
  };
}
