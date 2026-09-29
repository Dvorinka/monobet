// Minigame payout math — shared between the /games UI (odds display) and the
// server actions that settle rounds. No secrets here; tokens live in actions.

export const GAME_LEVERAGES = [1, 2, 3, 5, 10] as const;

// Coin flip: 50/50, house keeps ~2%.
export const COINFLIP_MULT = 1.96;

// Dice: roll 1–6, win on roll > `over`. Fair odds 6/(6−over), ~4% house edge.
export const DICE_MIN_OVER = 2;
export const DICE_MAX_OVER = 5;
export function diceMult(over: number) {
  return (6 / (6 - over)) * 0.96;
}
export function diceWinChance(over: number) {
  return (6 - over) / 6;
}

// Stop-the-timer: digits hide after this long; hit windows pay by precision.
export const TIMER_TARGETS = [5000, 10000] as const;
export const TIMER_REVEAL_MS = 2000;
export const TIMER_TIERS = [
  { errMs: 120, mult: 6 },
  { errMs: 300, mult: 2.5 },
  { errMs: 600, mult: 1.4 },
] as const;
export function timerMult(errMs: number) {
  return TIMER_TIERS.find((t) => errMs <= t.errMs)?.mult ?? 0;
}

// Limbo: pick a target multiplier; the crash point follows 0.99/(1−u) so
// P(win) = 0.99/target. Paying target×0.98 leaves a ~3% house edge.
// The roll itself is generated server-side (crypto randomInt) in actions.ts.
export const LIMBO_MIN = 1.05;
export const LIMBO_MAX = 50;
export function limboWinChance(target: number) {
  return 0.99 / target;
}

// Wheel: 12 fixed segments, weighted by the pointer landing index.
// Σ 11.4 / 12 ≈ 0.95 expected return — the zero wedges do the work.
export const WHEEL_SEGMENTS = [0, 1.5, 0.5, 0, 2.5, 0, 0.8, 0, 5, 0, 1.2, 0.6] as const;
export const WHEEL_STEP = 360 / WHEEL_SEGMENTS.length;
