import { describe, it, expect } from "vitest";
import {
  lmsrCost,
  yesPrice,
  qForProb,
  tradeCost,
  sharesForSpend,
  multiCoords,
  multiPrices,
  multiTradeCost,
  multiSharesForSpend,
  multiQForProb,
} from "./lmsr";

const B = 300;
const eps = 1e-9;

describe("lmsrCost", () => {
  it("is symmetric at the empty book", () => {
    expect(lmsrCost(0, 0, B)).toBeCloseTo(B * Math.log(2), 9);
  });

  it("grows with outstanding shares", () => {
    expect(lmsrCost(100, 0, B)).toBeGreaterThan(lmsrCost(50, 0, B));
    expect(lmsrCost(0, 100, B)).toBeGreaterThan(lmsrCost(0, 50, B));
  });
});

describe("yesPrice", () => {
  it("opens at 50%", () => {
    expect(yesPrice(0, 0, B)).toBeCloseTo(0.5, 12);
  });

  it("is in (0,1) and monotonic in qYes", () => {
    const ps = [-200, -20, 0, 20, 200].map((q) => yesPrice(q, 0, B));
    for (const p of ps) {
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThan(ps[i - 1]);
  });

  it("complements the no price", () => {
    expect(yesPrice(30, 0, B)).toBeCloseTo(1 - yesPrice(0, 30, B), 9);
  });
});

describe("qForProb", () => {
  it("seeds the book to the requested probability", () => {
    const q = qForProb(0.7, B);
    expect(yesPrice(q, 0, B)).toBeCloseTo(0.7, 9);
  });

  it("is zero at 50% and sign-symmetric", () => {
    expect(qForProb(0.5, B)).toBeCloseTo(0, 9);
    expect(qForProb(0.9, B)).toBeCloseTo(-qForProb(0.1, B), 9);
  });
});

describe("tradeCost", () => {
  it("buying yes costs more than the marginal price for size", () => {
    // At a 50% book, small buys cost ~0.5/share; bigger orders pay slippage.
    const small = tradeCost(0, 0, B, "yes", 0.01);
    const large = tradeCost(0, 0, B, "yes", 100);
    expect(small).toBeCloseTo(0.005, 6);
    expect(large / 100).toBeGreaterThan(0.5 + 1e-6);
  });

  it("round-trips: buy then sell returns less than spent (spread)", () => {
    const buy = tradeCost(0, 0, B, "yes", 50);
    const sell = tradeCost(50, 0, B, "yes", -50);
    expect(sell).toBeLessThan(-buy + eps); // refund magnitude < cost
  });

  it("selling outstanding shares refunds a positive amount", () => {
    expect(tradeCost(100, 0, B, "yes", -30)).toBeLessThan(0);
  });
});

describe("sharesForSpend", () => {
  it("cost of returned shares is <= spend and maximal", () => {
    const spend = 25;
    const s = sharesForSpend(0, 0, B, "yes", spend);
    const cost = tradeCost(0, 0, B, "yes", s);
    expect(cost).toBeLessThanOrEqual(spend);
    expect(spend - cost).toBeLessThan(0.01); // binary-search tightness
  });

  it("is monotonic in spend", () => {
    const s1 = sharesForSpend(0, 0, B, "no", 10);
    const s2 = sharesForSpend(0, 0, B, "no", 100);
    expect(s2).toBeGreaterThan(s1);
  });

  it("returns ~0 for negligible spend", () => {
    expect(sharesForSpend(0, 0, B, "yes", 1e-6)).toBeLessThan(0.01);
  });
});

describe("multi-outcome book", () => {
  // Six-option group seeded uniform — the book the user hit.
  const seeded = (ps: number[]) => ps.map((p) => ({ qYes: multiQForProb(p, B), qNo: 0 }));

  it("prices always sum to 1", () => {
    for (const opts of [seeded([1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6]), seeded([0.7, 0.1, 0.2]), seeded([0.99, 0.01])]) {
      const ps = multiPrices(multiCoords(opts), B);
      expect(ps.reduce((a, p) => a + p, 0)).toBeCloseTo(1, 12);
    }
  });

  it("opens at the seeded probabilities", () => {
    const target = [0.5, 0.3, 0.2];
    const ps = multiPrices(multiCoords(seeded(target)), B);
    ps.forEach((p, i) => expect(p).toBeCloseTo(target[i], 9));
  });

  it("fresh book without seeds is uniform", () => {
    const ps = multiPrices(multiCoords([{ qYes: 0, qNo: 0 }, { qYes: 0, qNo: 0 }, { qYes: 0, qNo: 0 }]), B);
    ps.forEach((p) => expect(p).toBeCloseTo(1 / 3, 12));
  });

  it("buying YES lifts that option's price and lowers siblings'", () => {
    const opts = seeded([0.5, 0.3, 0.2]);
    const before = multiPrices(multiCoords(opts), B);
    const s = multiSharesForSpend(multiCoords(opts), B, 0, "yes", 10);
    opts[0].qYes += s;
    const after = multiPrices(multiCoords(opts), B);
    expect(after[0]).toBeGreaterThan(before[0]);
    expect(after[1]).toBeLessThan(before[1]);
    expect(after[2]).toBeLessThan(before[2]);
  });

  it("buying NO lifts siblings and lowers the option", () => {
    const opts = seeded([0.5, 0.3, 0.2]);
    const before = multiPrices(multiCoords(opts), B);
    const s = multiSharesForSpend(multiCoords(opts), B, 0, "no", 10);
    opts[0].qNo += s;
    const after = multiPrices(multiCoords(opts), B);
    expect(after[0]).toBeLessThan(before[0]);
    expect(after[1]).toBeGreaterThan(before[1]);
    expect(after[2]).toBeGreaterThan(before[2]);
  });

  it("small NO buy costs ~(1 - p) per share, small YES ~p", () => {
    const opts = seeded([0.25, 0.25, 0.25, 0.25]);
    const coords = multiCoords(opts);
    expect(multiTradeCost(coords, B, 0, "yes", 0.01)).toBeCloseTo(0.0025, 5);
    expect(multiTradeCost(coords, B, 0, "no", 0.01)).toBeCloseTo(0.0075, 5);
  });

  it("round-trips: buy then sell returns less than spent", () => {
    const opts = seeded([0.4, 0.35, 0.25]);
    const coords = multiCoords(opts);
    const s = multiSharesForSpend(coords, B, 1, "yes", 25);
    const refund = multiTradeCost(coords, B, 1, "yes", -s);
    expect(refund).toBeLessThan(0);
    expect(-refund).toBeLessThan(25 + 1e-6);
  });

  it("dropout renormalizes the survivors", () => {
    const opts = seeded([0.5, 0.3, 0.2]);
    const survivors = opts.slice(1);
    const ps = multiPrices(multiCoords(survivors), B);
    expect(ps[0] / ps[1]).toBeCloseTo(0.3 / 0.2, 9);
    expect(ps.reduce((a, p) => a + p, 0)).toBeCloseTo(1, 12);
  });

  it("spend search is tight like the binary book", () => {
    const coords = multiCoords(seeded([0.5, 0.3, 0.2]));
    const s = multiSharesForSpend(coords, B, 2, "no", 25);
    const cost = multiTradeCost(coords, B, 2, "no", s);
    expect(cost).toBeLessThanOrEqual(25);
    expect(25 - cost).toBeLessThan(0.01);
  });
});
