import { describe, it, expect } from "vitest";
import { cardLabel, evalPerfectPairs, evalTwentyOnePlusThree, BJ_DECKS } from "./games";

// Card ints: rank + 13*suit + 52*deck (ranks 0=A..12=K, suits 0=♠ 1=♥ 2=♦ 3=♣)
const c = (rank: number, suit: number, deck = 0) => rank + 13 * suit + 52 * deck;

describe("cardLabel across a 4-deck shoe", () => {
  it("maps every deck copy to the same rank+suit", () => {
    for (let d = 0; d < BJ_DECKS; d++) {
      const l = cardLabel(c(12, 3, d)); // K♣ in deck d
      expect(l.rank).toBe("K");
      expect(l.suit).toBe("♣");
      expect(l.red).toBe(false);
    }
    expect(cardLabel(c(6, 1)).suit).toBe("♥");
    expect(cardLabel(c(6, 1)).red).toBe(true);
  });
});

describe("evalPerfectPairs", () => {
  it("pays 30x for the identical card from another deck", () => {
    expect(evalPerfectPairs([c(6, 1, 0), c(6, 1, 2)])).toEqual({ label: "ppPerfect", mult: 30 });
  });
  it("pays 12x for same-rank same-color pairs", () => {
    expect(evalPerfectPairs([c(6, 1), c(6, 2)])).toEqual({ label: "ppColored", mult: 12 }); // ♥+♦
    expect(evalPerfectPairs([c(6, 0), c(6, 3)])).toEqual({ label: "ppColored", mult: 12 }); // ♠+♣
  });
  it("pays 6x for mixed-color pairs", () => {
    expect(evalPerfectPairs([c(6, 0), c(6, 1)])).toEqual({ label: "ppMixed", mult: 6 });
  });
  it("returns null without a pair", () => {
    expect(evalPerfectPairs([c(6, 0), c(7, 0)])).toBeNull();
    expect(evalPerfectPairs([c(6, 0), c(6, 0), c(6, 0)])).toBeNull();
  });
});

describe("evalTwentyOnePlusThree", () => {
  it("pays 100x for suited trips", () => {
    expect(evalTwentyOnePlusThree([c(0, 0, 0), c(0, 0, 1)], c(0, 0, 2))).toEqual({ label: "t3Suited", mult: 100 });
  });
  it("pays 40x for a straight flush", () => {
    expect(evalTwentyOnePlusThree([c(3, 1), c(4, 1)], c(5, 1))).toEqual({ label: "t3SF", mult: 40 });
  });
  it("pays 30x for unsuited trips", () => {
    expect(evalTwentyOnePlusThree([c(8, 0), c(8, 1)], c(8, 2))).toEqual({ label: "t3Trips", mult: 30 });
  });
  it("pays 10x for a straight, ace-high and ace-low included", () => {
    expect(evalTwentyOnePlusThree([c(3, 0), c(4, 1)], c(5, 2))).toEqual({ label: "t3Straight", mult: 10 });
    expect(evalTwentyOnePlusThree([c(11, 0), c(12, 1)], c(0, 2))).toEqual({ label: "t3Straight", mult: 10 }); // Q-K-A
    expect(evalTwentyOnePlusThree([c(0, 0), c(1, 1)], c(2, 2))).toEqual({ label: "t3Straight", mult: 10 }); // A-2-3
  });
  it("does not count J-Q-A as a straight", () => {
    expect(evalTwentyOnePlusThree([c(10, 0), c(11, 1)], c(0, 2))).toBeNull();
  });
  it("pays 5x for a flush", () => {
    expect(evalTwentyOnePlusThree([c(1, 0), c(5, 0)], c(9, 0))).toEqual({ label: "t3Flush", mult: 5 });
  });
  it("returns null on a miss", () => {
    expect(evalTwentyOnePlusThree([c(1, 0), c(5, 1)], c(9, 2))).toBeNull();
  });
});
