// LMSR (logarithmic market scoring rule) binary market maker.
// qYes/qNo = net shares issued per outcome. Prices are probabilities in (0,1).
// Buying pushes the price toward 1; selling back reduces outstanding shares.

export function lmsrCost(qYes: number, qNo: number, b: number): number {
  const m = Math.max(qYes, qNo);
  return m + b * Math.log(Math.exp((qYes - m) / b) + Math.exp((qNo - m) / b));
}

export function yesPrice(qYes: number, qNo: number, b: number): number {
  return 1 / (1 + Math.exp((qNo - qYes) / b));
}

// Yes-side quantity that makes the LMSR open at probability `p` (qNo = 0).
export function qForProb(p: number, b: number): number {
  return b * Math.log(p / (1 - p));
}

// Cost in marks to buy `shares` of `outcome` (or refund when shares < 0).
export function tradeCost(
  qYes: number,
  qNo: number,
  b: number,
  outcome: "yes" | "no",
  shares: number
): number {
  const before = lmsrCost(qYes, qNo, b);
  const after =
    outcome === "yes" ? lmsrCost(qYes + shares, qNo, b) : lmsrCost(qYes, qNo + shares, b);
  return after - before;
}

// Shares obtainable for `spend` marks of `outcome` via binary search (cost is monotonic).
export function sharesForSpend(
  qYes: number,
  qNo: number,
  b: number,
  outcome: "yes" | "no",
  spend: number
): number {
  let lo = 0;
  let hi = spend * 2 + b * 4;
  while (tradeCost(qYes, qNo, b, outcome, hi) < spend) hi *= 2;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (tradeCost(qYes, qNo, b, outcome, mid) <= spend) lo = mid;
    else hi = mid;
  }
  return lo;
}
