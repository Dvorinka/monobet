import { describe, it, expect } from "vitest";
import { PLINKO_ROWS, PLINKO_MULT, PLINKO_CENTER, PLINKO_ROW_CHOICES, plinkoMults, plinkoBucket, plinkoPathForBucket } from "./games";

// p(k) = C(rows, k) / 2^rows — the ball is a binomial walk.
const expectedReturn = (mults: number[], rows: number) =>
  mults.reduce((s, m, k) => {
    let c = 1;
    for (let i = 0; i < k; i++) c = (c * (rows - i)) / (i + 1);
    return s + (m * c) / 2 ** rows;
  }, 0);

describe("plinko", () => {
  it("has one pocket per landing slot", () => {
    expect(PLINKO_MULT).toHaveLength(PLINKO_ROWS + 1);
    expect(PLINKO_CENTER).toBe(PLINKO_ROWS / 2);
  });

  it("pays out ~84% at every board size — the pockets do the work, not a hidden rake", () => {
    for (const rows of PLINKO_ROW_CHOICES) {
      const mults = plinkoMults(rows);
      expect(mults).toHaveLength(rows + 1);
      const rtp = expectedReturn(mults, rows);
      expect(rtp).toBeGreaterThan(0.8);
      expect(rtp).toBeLessThan(0.9);
    }
  });

  it("is symmetric and unimodal — outward always pays more", () => {
    for (const rows of PLINKO_ROW_CHOICES) {
      const mults = plinkoMults(rows);
      for (let k = 0; k < rows; k++) expect(mults[k]).toBe(mults[rows - k]);
      for (let k = 0; k < rows / 2; k++) expect(mults[k]).toBeGreaterThan(mults[k + 1]);
    }
  });

  it("bucket counts the right-bounces", () => {
    expect(plinkoBucket([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(0);
    expect(plinkoBucket([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toBe(PLINKO_ROWS);
    expect(plinkoBucket([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0])).toBe(6);
  });

  it("rebuilds a valid path for any pocket after rig/luck moves it", () => {
    let seed = 42;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) >>> 0) % n);
    for (const rows of PLINKO_ROW_CHOICES) {
      for (let k = 0; k <= rows; k++) {
        const path = plinkoPathForBucket(k, rand, rows);
        expect(path).toHaveLength(rows);
        expect(plinkoBucket(path)).toBe(k);
      }
    }
  });
});
