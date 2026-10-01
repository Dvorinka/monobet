import { describe, it, expect } from "vitest";
import { cardOrder, cardIsRed, hiloMult, hiloWinRanks, MAX_GAME_STAKE_CENTS, REDBLACK_MULT, GAME_KEYS } from "./games";

// Card ints: rank + 13*suit (ranks 0=A..12=K, suits 0=♠ 1=♥ 2=♦ 3=♣)
const c = (rank: number, suit = 0) => rank + 13 * suit;

describe("cardOrder", () => {
  it("aces high, suit does not matter", () => {
    expect(cardOrder(c(0))).toBe(13);
    expect(cardOrder(c(12))).toBe(12); // K
    expect(cardOrder(c(1))).toBe(1); // 2 is the rail
    for (let s = 0; s < 4; s++) expect(cardOrder(c(5, s))).toBe(5);
  });
});

describe("cardIsRed", () => {
  it("hearts + diamonds red, spades + clubs black", () => {
    expect(cardIsRed(c(5, 1))).toBe(true);
    expect(cardIsRed(c(5, 2))).toBe(true);
    expect(cardIsRed(c(5, 0))).toBe(false);
    expect(cardIsRed(c(5, 3))).toBe(false);
  });
});

describe("hiloMult", () => {
  it("pays inverse probability with the edge folded in", () => {
    // face 6 (order 5): 8 ranks above → 0.92·13/8 = 1.495 → floored 1.49
    expect(hiloMult(c(5), "higher")).toBeCloseTo(1.49, 2);
    // 4 ranks below → 0.92·13/4 = 2.99
    expect(hiloMult(c(5), "lower")).toBeCloseTo(2.99, 2);
  });
  it("dead calls pay nothing — nothing beats an ace upward, nothing under a 2", () => {
    expect(hiloMult(c(0), "higher")).toBe(0);
    expect(hiloMult(c(1), "lower")).toBe(0);
    expect(hiloMult(c(0), "lower")).toBeCloseTo(0.99, 2); // ace low: 12 winning ranks
  });
  it("every payable call stays under fair odds", () => {
    for (let r = 0; r < 13; r++) {
      for (const dir of ["higher", "lower"] as const) {
        const m = hiloMult(c(r), dir);
        const fair = 13 / hiloWinRanks(cardOrder(c(r)), dir);
        expect(m).toBeLessThan(fair);
      }
    }
  });
});

describe("economy caps", () => {
  it("base stake is capped at Ɱ1 000 across every game", () => {
    expect(MAX_GAME_STAKE_CENTS).toBe(100_000);
    expect(GAME_KEYS).toContain("hilo");
    expect(GAME_KEYS).toContain("redblack");
  });
  it("red/black pays under fair odds", () => {
    expect(REDBLACK_MULT).toBeLessThan(2);
  });
});
