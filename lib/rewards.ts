// Reward catalog — all amounts in cents (Ɱ100 = 10_000).
export const DAILY_AMOUNT = 25_000;
export const DAILY_COOLDOWN_MS = 20 * 3600 * 1000;
export const WEEKLY_AMOUNT = 100_000; // Ɱ1,000
export const WEEKLY_COOLDOWN_MS = 7 * 24 * 3600 * 1000;
export const AD_AMOUNT = 5_000; // Ɱ50
export const AD_COOLDOWN_MS = 30 * 60 * 1000;
export const AD_WATCH_MS = 12_000;

// One-time bonuses. `check` milestones are verified server-side; link bonuses
// open their href in the same click that claims — the visit IS the claim.
export const BONUSES = [
  { key: "portfolio", amountCents: 10_000, href: "https://www.tdvorak.dev/", check: null },
  { key: "instagram", amountCents: 10_000, href: "https://www.instagram.com/tdvorak.dev/", check: null },
  { key: "github", amountCents: 7_500, href: "https://github.com/Dvorinka/monobet", check: null },
  { key: "first_bet", amountCents: 10_000, href: null, check: "bet" },
  { key: "first_market", amountCents: 15_000, href: "/propose", check: "market" },
  { key: "first_comment", amountCents: 5_000, href: "/", check: "comment" },
  { key: "first_game", amountCents: 5_000, href: "/games", check: "game" },
  { key: "first_win", amountCents: 15_000, href: "/games", check: "win" },
  { key: "avatar", amountCents: 5_000, href: null, check: "avatar" },
  { key: "watchlist", amountCents: 2_500, href: "/markets", check: "watchlist" },
  { key: "heart", amountCents: 2_500, href: "/markets", check: "like" },
  { key: "duel", amountCents: 7_500, href: "/duels", check: "duel" },
  { key: "squad", amountCents: 5_000, href: null, check: "squad" },
  { key: "ten_trades", amountCents: 20_000, href: "/markets", check: "tenTrades" },
  { key: "streak7", amountCents: 25_000, href: null, check: "streak7" },
] as const;

export type BonusKey = (typeof BONUSES)[number]["key"];
export const BONUS_MAP = new Map(BONUSES.map((b) => [b.key, b]));

// Referral: the invitee gets this once, the referrer gets REFERRER_BONUS per join.
export const REFEREE_BONUS = 10_000;
export const REFERRER_BONUS = 20_000;

// Claim streaks: gap must stay under 48h (20h cooldown + slack) to keep the
// streak alive; each streak day adds Marks up to a 7-day cap.
export const STREAK_WINDOW_MS = 48 * 3600 * 1000;
export const STREAK_PER_DAY_CENTS = 1_000;
export const STREAK_CAP_DAYS = 7;

// Weekly seasons: lazy settlement, podium rewards.
export const SEASON_LENGTH_MS = 7 * 24 * 3600 * 1000;
export const SEASON_REWARDS = [200_000, 100_000, 50_000] as const;
