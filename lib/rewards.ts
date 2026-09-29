// Reward catalog — all amounts in cents (Ɱ100 = 10_000).
export const DAILY_AMOUNT = 25_000;
export const DAILY_COOLDOWN_MS = 20 * 3600 * 1000;
export const WEEKLY_AMOUNT = 100_000; // Ɱ1,000
export const WEEKLY_COOLDOWN_MS = 7 * 24 * 3600 * 1000;
export const AD_AMOUNT = 5_000; // Ɱ50
export const AD_COOLDOWN_MS = 5 * 60 * 1000;
export const AD_WATCH_MS = 12_000;

// One-time bonuses. `check` milestones are verified server-side; links are honor-system.
export const BONUSES = [
  { key: "portfolio", amountCents: 10_000, href: "https://www.tdvorak.dev/", check: null },
  { key: "instagram", amountCents: 10_000, href: "https://www.instagram.com/tdvorak.dev/", check: null },
  { key: "github", amountCents: 7_500, href: "https://github.com/Dvorinka/monobet", check: null },
  { key: "first_bet", amountCents: 10_000, href: null, check: "bet" },
  { key: "first_market", amountCents: 15_000, href: "/propose", check: "market" },
  { key: "first_comment", amountCents: 5_000, href: "/", check: "comment" },
] as const;

export type BonusKey = (typeof BONUSES)[number]["key"];
export const BONUS_MAP = new Map(BONUSES.map((b) => [b.key, b]));

// Referral: the invitee gets this once, the referrer gets REFERRER_BONUS per join.
export const REFEREE_BONUS = 10_000;
export const REFERRER_BONUS = 20_000;
