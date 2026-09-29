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
