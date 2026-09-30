import { describe, it, expect } from "vitest";
import { blessedChancePct, WALL_BLESSED_RE, BLESS_BASE_PCT, BLESS_MAX_PCT } from "./games";

describe("blessedChancePct — prayer-scaled rig for Bibi's table", () => {
  it("starts at the base chance with no prayers", () => {
    expect(blessedChancePct(0)).toBe(BLESS_BASE_PCT);
  });
  it("grows one step per prayer", () => {
    expect(blessedChancePct(3)).toBe(BLESS_BASE_PCT + 18);
  });
  it("caps instead of ever promising a sure thing", () => {
    expect(blessedChancePct(10_000)).toBe(BLESS_MAX_PCT);
    expect(blessedChancePct(10_000)).toBeLessThan(50);
  });
  it("never dips below the base for negative counts", () => {
    expect(blessedChancePct(-5)).toBe(BLESS_BASE_PCT);
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
