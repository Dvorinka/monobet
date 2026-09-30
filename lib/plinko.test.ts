import { describe, it, expect } from "vitest";
import { PLINKO_ROWS, PLINKO_MULT, PLINKO_CENTER, plinkoBucket, plinkoPathForBucket } from "./games";

// p(k) = C(rows, k) / 2^rows — the ball is a binomial walk.
const expectedReturn = () =>
  PLINKO_MULT.reduce((s, m, k) => {
    let c = 1;
    for (let i = 0; i < k; i++) c = (c * (PLINKO_ROWS - i)) / (i + 1);
    return s + (m * c) / 2 ** PLINKO_ROWS;
  }, 0);

describe("plinko", () => {
  it("has one pocket per landing slot", () => {
    expect(PLINKO_MULT).toHaveLength(PLINKO_ROWS + 1);
    expect(PLINKO_CENTER).toBe(PLINKO_ROWS / 2);
  });

  it("pays out ~96% — the pockets do the work, not a hidden rake", () => {
    const rtp = expectedReturn();
    expect(rtp).toBeGreaterThan(0.94);
    expect(rtp).toBeLessThan(1);
  });

  it("is symmetric and unimodal — outward always pays more", () => {
    for (let k = 0; k < PLINKO_ROWS; k++)
      expect(PLINKO_MULT[k]).toBe(PLINKO_MULT[PLINKO_ROWS - k]);
    for (let k = 0; k < PLINKO_CENTER; k++)
      expect(PLINKO_MULT[k]).toBeGreaterThan(PLINKO_MULT[k + 1]);
  });

  it("bucket counts the right-bounces", () => {
    expect(plinkoBucket([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(0);
    expect(plinkoBucket([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toBe(PLINKO_ROWS);
    expect(plinkoBucket([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0])).toBe(6);
  });

  it("rebuilds a valid path for any pocket after rig/luck moves it", () => {
    let seed = 42;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) >>> 0) % n);
    for (let k = 0; k <= PLINKO_ROWS; k++) {
      const path = plinkoPathForBucket(k, rand);
      expect(path).toHaveLength(PLINKO_ROWS);
      expect(plinkoBucket(path)).toBe(k);
    }
  });
});
