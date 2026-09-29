import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  numeric,
  doublePrecision,
  uuid,
  index,
  primaryKey,
  smallint,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ---------- Better Auth core tables ----------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // username plugin
  username: text("username").unique(),
  displayUsername: text("display_username"),
  // MonoBet additional fields
  role: text("role").notNull().default("user"),
  balanceCents: integer("balance_cents").notNull().default(100_000), // Ɱ1,000.00 start
  lastClaimAt: timestamp("last_claim_at", { withTimezone: true }),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- MonoBet tables ----------

export type MarketStatus = "pending" | "live" | "resolved" | "cancelled" | "rejected";
export type MarketOutcome = "yes" | "no";
export type MarketKind = "binary" | "group" | "option";

// User-creatable market categories — rows seeded by drizzle/0004_categories.sql;
// anyone can add one when creating a market, admins rename/delete in /admin.
export const category = pgTable("category", {
  name: text("name").primaryKey(),
  sortIndex: integer("sort_index").notNull().default(0),
  creatorId: text("creator_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const market = pgTable(
  "market",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    question: text("question").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull().default("Other"),
    status: text("status").notNull().default("pending"),
    outcome: text("outcome"), // 'yes' | 'no' | null
    // Multi-outcome markets: a "group" parent holds the shared question;
    // each "option" child is an independent binary market with its own prices.
    kind: text("kind").notNull().default("binary"),
    parentId: uuid("parent_id").references((): AnyPgColumn => market.id, { onDelete: "cascade" }),
    label: text("label"), // option label on children, e.g. "September 30"
    sortIndex: integer("sort_index").notNull().default(0), // option order within a group
    imageUrl: text("image_url"), // optional picture — option logos, market icons
    b: doublePrecision("b").notNull().default(300), // LMSR liquidity parameter
    qYes: numeric("q_yes", { precision: 24, scale: 6 }).notNull().default("0"),
    qNo: numeric("q_no", { precision: 24, scale: 6 }).notNull().default("0"),
    volumeCents: bigint("volume_cents", { mode: "number" }).notNull().default(0),
    traderCount: integer("trader_count").notNull().default(0),
    creatorId: text("creator_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("market_status_idx").on(t.status),
    index("market_category_idx").on(t.category),
    index("market_parent_idx").on(t.parentId),
  ]
);

export const trade = pgTable(
  "trade",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id").notNull().references(() => market.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    side: text("side").notNull(), // 'buy' | 'sell'
    outcome: text("outcome").notNull(), // 'yes' | 'no'
    shares: numeric("shares", { precision: 24, scale: 6 }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    yesPriceAfter: numeric("yes_price_after", { precision: 7, scale: 5 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("trade_market_idx").on(t.marketId, t.createdAt),
    index("trade_user_idx").on(t.userId, t.createdAt),
  ]
);

export const position = pgTable(
  "position",
  {
    marketId: uuid("market_id").notNull().references(() => market.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    yesShares: numeric("yes_shares", { precision: 24, scale: 6 }).notNull().default("0"),
    noShares: numeric("no_shares", { precision: 24, scale: 6 }).notNull().default("0"),
  },
  (t) => [primaryKey({ columns: [t.marketId, t.userId] }), index("position_user_idx").on(t.userId)]
);

export const pricePoint = pgTable(
  "price_point",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    marketId: uuid("market_id").notNull().references(() => market.id, { onDelete: "cascade" }),
    yesPrice: numeric("yes_price", { precision: 7, scale: 5 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pp_market_idx").on(t.marketId, t.createdAt)]
);

export const comment = pgTable(
  "comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id").notNull().references(() => market.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comment_market_idx").on(t.marketId, t.createdAt)]
);

export const commentVote = pgTable(
  "comment_vote",
  {
    commentId: uuid("comment_id").notNull().references(() => comment.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    value: smallint("value").notNull(), // 1 | -1
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId] })]
);

export const rewardClaim = pgTable(
  "reward_claim",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // 'weekly' | 'ad' | 'bonus:<key>'
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reward_user_idx").on(t.userId, t.createdAt)]
);

export type LedgerKind =
  | "signup"
  | "claim"
  | "weekly"
  | "ad"
  | "bonus"
  | "grant"
  | "buy"
  | "sell"
  | "payout"
  | "refund";

export const ledger = pgTable(
  "ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(), // signed
    balanceAfterCents: bigint("balance_after_cents", { mode: "number" }).notNull(),
    kind: text("kind").notNull(),
    marketId: uuid("market_id").references(() => market.id, { onDelete: "set null" }),
    memo: text("memo").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ledger_user_idx").on(t.userId, t.createdAt)]
);
