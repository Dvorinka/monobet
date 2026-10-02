import { describe, it, expect } from "vitest";
import { GAME_LEVERAGES, GAME_FEE_CENTS } from "./games";

describe("minigame limits", () => {
  it("caps leverage at 10x server-side and in the UI chips", () => {
    expect(Math.max(...GAME_LEVERAGES)).toBe(10);
    expect(GAME_LEVERAGES).not.toContain(25);
  });

  it("charges a flat Ɱ1 fee per round", () => {
    expect(GAME_FEE_CENTS).toBe(100);
  });
});
