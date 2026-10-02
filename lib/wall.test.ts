import { describe, it, expect } from "vitest";
import { blessedChancePct, WALL_BLESSED_RE, BLESS_PER_PRAYER_PCT, BLESS_MAX_PCT } from "./games";

describe("blessedChancePct — prayer-scaled rig for Bibi's table", () => {
  it("does nothing for players with no wall nodes", () => {
    expect(blessedChancePct(0)).toBe(0);
  });
  it("grows one step per prayer", () => {
    expect(blessedChancePct(1)).toBe(BLESS_PER_PRAYER_PCT);
    expect(blessedChancePct(3)).toBe(3 * BLESS_PER_PRAYER_PCT);
  });
  it("caps instead of ever promising a sure thing", () => {
    expect(blessedChancePct(10_000)).toBe(BLESS_MAX_PCT);
    expect(blessedChancePct(10_000)).toBeLessThanOrEqual(10);
  });
  it("never dips below zero for negative counts", () => {
    expect(blessedChancePct(-5)).toBe(0);
  });
});

describe("WALL_BLESSED_RE — prayers naming the holy land", () => {
  it("matches israel and its kin, any casing", () => {
    for (const s of ["for Israel", "ISRAELI shekels", "tel aviv", "Tel-Aviv", "bibi please", "Netanyahu", "Jerusalem stone", "shalom", "the promised land"]) {
      expect(WALL_BLESSED_RE.test(s)).toBe(true);
    }
  });
  it("does not fire on ordinary prayers", () => {
    for (const s of ["forgive my debts", "I love bagels", "please erase my loan", "smoke on the water"]) {
      expect(WALL_BLESSED_RE.test(s)).toBe(false);
    }
  });
});
