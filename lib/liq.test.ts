import { describe, it, expect } from "vitest";
import { loanFor, LIQ_CUSHION, liqCushion, liquidationValueCents, shouldLiquidate, levFeeCents, levFeeBpsEff, levWinCents, levWinRawCents, LEV_FEE_BPS } from "./liq";
import { tradeCost, sharesForSpend } from "./lmsr";

const B = 300;

describe("loanFor", () => {
  it("scales the loan by leverage minus collateral", () => {
    expect(loanFor(1000, 1)).toBe(0);
    expect(loanFor(1000, 2)).toBe(1000);
    expect(loanFor(1000, 10)).toBe(9000);
  });
});

describe("liquidationValueCents", () => {
  it("unleveraged position always beats any debt check above zero", () => {
    const y = sharesForSpend(0, 0, B, "yes", 10);
    const v = liquidationValueCents(y, 0, B, y, 0);
    expect(v).toBeGreaterThan(0);
    expect(shouldLiquidate(v, 0)).toBe(false);
  });

  it("value equals the sell proceeds the trade path would pay", () => {
    const y = sharesForSpend(0, 0, B, "yes", 20);
    const expected = Math.round(-tradeCost(y, 0, B, "yes", -y) * 100);
    expect(liquidationValueCents(y, 0, B, y, 0)).toBeCloseTo(expected, 0);
  });

  it("liquidates once the price moves against the position", () => {
    // Ɱ50 collateral at 10x -> Ɱ500 notional in shares, Ɱ450 loaned.
    const collateral = 5000;
    const debt = loanFor(collateral, 10);
    const y = sharesForSpend(0, 0, B, "yes", collateral * 10 / 100);

    // Fresh book: value comfortably above the cushion.
    expect(liquidationValueCents(y, 0, B, y, 0)).toBeGreaterThan(debt * LIQ_CUSHION);

    // Someone buys Ɱ200 of NO — the yes side is now deep underwater.
    const n = sharesForSpend(y, 0, B, "no", 200);
    const v = liquidationValueCents(y, n, B, y, 0);
    expect(shouldLiquidate(v, debt)).toBe(true);
  });

  it("mixed yes/no position sells no against post-yes state", () => {
    const v = liquidationValueCents(50, 20, B, 10, 10);
    const manual = Math.round(
      -(tradeCost(50, 20, B, "yes", -10) + tradeCost(40, 20, B, "no", -10)) * 100
    );
    expect(v).toBe(manual);
  });
});

describe("shouldLiquidate", () => {
  it("triggers at and below the cushion boundary", () => {
    const debt = 1000;
    expect(shouldLiquidate(Math.floor(debt * LIQ_CUSHION), debt)).toBe(true);
    expect(shouldLiquidate(Math.ceil(debt * LIQ_CUSHION) + 1, debt)).toBe(false);
  });

  it("keeps the 5% cushion on markets capped at 20x or below", () => {
    expect(liqCushion(20)).toBe(LIQ_CUSHION);
    expect(liqCushion(10)).toBe(LIQ_CUSHION);
    expect(liqCushion(1)).toBe(LIQ_CUSHION);
  });

  it("shrinks the cushion so high-leverage positions are born alive", () => {
    // Entry equity = debt/(L-1) — the cushion must sit below it or every
    // position at the cap would liquidate the moment it opens.
    expect(liqCushion(50)).toBeCloseTo(1 + 0.05 * 19 / 49, 10);
    expect(liqCushion(100)).toBeCloseTo(1 + 0.05 * 19 / 99, 10);
    expect(liqCushion(100)).toBeLessThan(100 / 99); // entry ratio at 100x
    // Ɱ10 collateral at 100x: debt Ɱ990, entry value ≈ notional Ɱ1000.
    const debt = loanFor(1000, 100);
    expect(shouldLiquidate(100_000, debt, 100)).toBe(false); // born alive
    expect(shouldLiquidate(Math.floor(debt * liqCushion(100)), debt, 100)).toBe(true);
  });
});

describe("game margin (levFeeCents / levWinRawCents / levWinCents)", () => {
  it("charges nothing at 1x — unlevered play only pays the flat round fee", () => {
    expect(levFeeCents(10_000, 1)).toBe(0);
    expect(levFeeCents(50_000, 1, 900)).toBe(0);
    expect(levFeeBpsEff(1)).toBe(LEV_FEE_BPS); // quoted rate, just never charged
  });

  it("scales the rate by 5x tiers — bigger leverage pays progressively more", () => {
    expect(LEV_FEE_BPS).toBe(500);
    expect(levFeeBpsEff(2)).toBe(500); // tier 1
    expect(levFeeBpsEff(5)).toBe(500);
    expect(levFeeBpsEff(6)).toBe(1000); // tier 2
    expect(levFeeBpsEff(10)).toBe(1000);
    expect(levFeeBpsEff(25)).toBe(2500); // tier 5
    expect(levFeeCents(10_000, 5)).toBe(Math.round(10_000 * 4 * 0.05)); // Ɱ20
    expect(levFeeCents(10_000, 10)).toBe(Math.round(10_000 * 9 * 0.1)); // Ɱ90
    expect(levFeeCents(10_000, 5, 200)).toBe(Math.round(10_000 * 4 * 0.02)); // custom rate
  });

  it("amplifies profit by leverage but always returns the stake", () => {
    // Ɱ100 at 5x into a 2.4x limbo: stake back + 1.4 profit x 5.
    expect(levWinCents(10_000, 5, 2.4)).toBe(Math.round(10_000 * (1 + 1.4 * 5)));
    // Unleveraged reduces to the plain multiplier.
    expect(levWinCents(10_000, 1, 2.4)).toBe(Math.round(10_000 * 2.4));
  });

  it("raw return goes negative on leveraged sub-1x rounds — that's the debt", () => {
    // Ɱ100 at 10x on a 0.5x return: notional Ɱ1000 halves → Ɱ500 back, the
    // Ɱ900 loan eats it + the Ɱ100 stake → Ɱ400 unpaid = debt.
    expect(levWinRawCents(10_000, 10, 0.5)).toBe(-40_000);
    expect(levWinCents(10_000, 10, 0.5)).toBe(0); // floored for crediting
    // Total loss (mult 0) owes the whole loan.
    expect(levWinRawCents(10_000, 10, 0)).toBe(-90_000);
    // Unleveraged can't go negative below zero.
    expect(levWinRawCents(10_000, 1, 0)).toBe(0);
  });
});
