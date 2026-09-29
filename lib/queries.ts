import { db, schema } from "@/lib/db";
import { eq, desc, asc, and, ilike, or, sql, inArray } from "drizzle-orm";
import { yesPrice } from "@/lib/lmsr";
import type { MarketStatus } from "@/lib/db/schema";

export type MarketRow = typeof schema.market.$inferSelect;

export function marketYesPrice(m: MarketRow): number {
  return yesPrice(Number(m.qYes), Number(m.qNo), m.b);
}

export async function listMarkets(opts: {
  category?: string;
  q?: string;
  sort?: string;
  status?: MarketStatus;
  includePendingForUser?: string;
}) {
  const { category, q, sort, status = "live" } = opts;
  const conds = [];
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

export async function getComments(marketId: string) {
  return db
    .select({
      id: schema.comment.id,
      body: schema.comment.body,
      createdAt: schema.comment.createdAt,
      userId: schema.comment.userId,
      username: schema.user.username,
      name: schema.user.name,
    })
    .from(schema.comment)
    .innerJoin(schema.user, eq(schema.comment.userId, schema.user.id))
    .where(eq(schema.comment.marketId, marketId))
    .orderBy(asc(schema.comment.createdAt))
    .limit(200);
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
      // Resolved markets price winning shares at 1, losing at 0.
      const valueCents =
        m.status === "resolved"
          ? Math.round((m.outcome === "yes" ? y : n) * 100)
          : Math.round((y * py + n * (1 - py)) * 100);
      return { market: m, yesShares: y, noShares: n, valueCents };
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
    const v =
      m.status === "resolved"
        ? Number(m.outcome === "yes" ? p.yesShares : p.noShares) * 100
        : (Number(p.yesShares) * py + Number(p.noShares) * (1 - py)) * 100;
    valueByUser.set(p.userId, (valueByUser.get(p.userId) ?? 0) + v);
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
      role: schema.user.role,
      balanceCents: schema.user.balanceCents,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .orderBy(asc(schema.user.createdAt));
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
    .where(and(eq(schema.market.category, category), eq(schema.market.status, "live"), sql`${schema.market.id} <> ${marketId}`))
    .orderBy(desc(schema.market.volumeCents))
    .limit(limit);
}
