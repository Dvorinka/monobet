import { describe, it, expect } from "vitest";
import { GAME_LEVERAGES, GAME_FEE_CENTS, gameLevCap, gameBetCap, diceMult, LIMBO_MIN, LIMBO_PAYOUT } from "./games";

describe("minigame limits", () => {
  it("offers the full lever menu — the effective cap lives in casino_config", () => {
    expect(Math.max(...GAME_LEVERAGES)).toBe(100);
    expect(GAME_LEVERAGES).toContain(10);
  });

  it("defaults the effective cap to 10x", () => {
    expect(gameLevCap(undefined, "dice")).toBe(10);
    expect(gameLevCap({ gameMaxLev: 10 }, "dice")).toBe(10);
  });

  it("honors the global cap and per-game overrides", () => {
    expect(gameLevCap({ gameMaxLev: 25 }, "dice")).toBe(25);
    expect(gameLevCap({ gameMaxLev: 25, gameLevCaps: { dice: 5 } }, "dice")).toBe(5);
    expect(gameLevCap({ gameMaxLev: 25, gameLevCaps: { dice: 5 } }, "limbo")).toBe(25);
  });

  it("never exceeds the biggest lever the engine supports", () => {
    expect(gameLevCap({ gameMaxLev: 999 }, "dice")).toBe(100);
    expect(gameLevCap({ gameLevCaps: { dice: 0 } }, "dice")).toBe(1);
  });

  it("charges a flat Ɱ1 fee per round", () => {
    expect(GAME_FEE_CENTS).toBe(100);
  });
});

describe("stake caps (gameBetCap)", () => {
  it("defaults to Ɱ1,000 when no config is loaded", () => {
    expect(gameBetCap(undefined, "dice")).toBe(100_000);
  });

  it("honors the global cap and per-game overrides", () => {
    expect(gameBetCap({ gameMaxBetCents: 50_000 }, "dice")).toBe(50_000);
    expect(gameBetCap({ gameMaxBetCents: 50_000, gameBetCaps: { dice: 5_000 } }, "dice")).toBe(5_000);
    expect(gameBetCap({ gameMaxBetCents: 50_000, gameBetCaps: { dice: 5_000 } }, "limbo")).toBe(50_000);
  });
});

describe("tightened odds", () => {
  it("dice runs an ~8% edge", () => {
    // fair 6/(6-over) multiplied by 0.92 — EV ≈ 0.92 on a fair roll.
    expect(diceMult(3)).toBeCloseTo(2 * 0.92, 4);
  });

  it("limbo can't be set near 1x and pays 96% of target", () => {
    expect(LIMBO_MIN).toBe(1.1);
    expect(LIMBO_PAYOUT).toBe(0.96);
  });
});
