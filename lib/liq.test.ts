import { describe, it, expect } from "vitest";
import { loanFor, LIQ_CUSHION, liquidationValueCents, shouldLiquidate } from "./liq";
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
});
