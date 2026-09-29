import { randomInt } from "node:crypto";

// House debt — levered game losses and loans land on the user row with an
// APR rolled at borrow time (taking a loan is itself a gamble). Interest
// accrues lazily: every touch compounds the debt to `now` first.
export const DEBT_CAP_CENTS = 100_000_000; // Ɱ1M ceiling — keeps integer sane
export const LOAN_PRESETS_CENTS = [25_000, 100_000, 500_000]; // Ɱ250 / Ɱ1,000 / Ɱ5,000
export const LOAN_RATE_MIN_BPS = 500; // 5% APR
export const LOAN_RATE_MAX_BPS = 8000; // 80% APR — the house is feeling generous

export function rollRateBps(): number {
  return LOAN_RATE_MIN_BPS + randomInt(LOAN_RATE_MAX_BPS - LOAN_RATE_MIN_BPS + 1);
}

export function accruedDebtCents(debt: number, rateBps: number, since: Date | null, now = new Date()): number {
  if (debt <= 0) return 0;
  if (!since || rateBps <= 0) return Math.min(DEBT_CAP_CENTS, Math.round(debt));
  const yrs = Math.max(0, (now.getTime() - new Date(since).getTime()) / (365 * 86400e3));
  return Math.min(DEBT_CAP_CENTS, Math.round(debt * Math.pow(1 + rateBps / 10000, yrs)));
}
