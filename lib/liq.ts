// Leverage accounting — pure math shared by the trade actions.
import { tradeCost } from "./lmsr";

// Principal of the loan a buy takes at `leverage`: collateral × (L-1).
export const loanFor = (spendCents: number, leverage: number) => spendCents * (leverage - 1);

// Liquidate when the position's liquidation value drops to 105% of its debt.
export const LIQ_CUSHION = 1.05;

// Cents the book pays if the position is sold fully right now: YES out first,
// then NO against the post-YES state (same order checkLiquidations applies).
// tradeCost returns a negative delta on the way out — negate to get the payout.
export function liquidationValueCents(
  qYes: number,
  qNo: number,
  b: number,
  yesShares: number,
  noShares: number
): number {
  return Math.round(
    -(tradeCost(qYes, qNo, b, "yes", -yesShares) +
      tradeCost(qYes - yesShares, qNo, b, "no", -noShares)) * 100
  );
}

export function shouldLiquidate(valueCents: number, debtCents: number): boolean {
  return valueCents <= debtCents * LIQ_CUSHION;
}

// --- Game leverage (eToro-style, no debt) ---
// A leveraged bet posts the stake as margin: a win pays stake + (mult-1) ×
// notional, a loss forfeits the stake — never more. The leveraged top-up is
// bought with a one-off funding fee (like a broker's spread), charged up front.
export const LEV_FEE_BPS = 200; // 2% of the borrowed notional per play
export function levFeeCents(betCents: number, leverage: number): number {
  if (leverage <= 1) return 0;
  return Math.round(betCents * (leverage - 1) * (LEV_FEE_BPS / 10_000));
}
// Win payout under margin rules: stake back plus amplified profit.
export function levWinCents(betCents: number, leverage: number, mult: number): number {
  return Math.round(betCents * (1 + (mult - 1) * leverage));
}
