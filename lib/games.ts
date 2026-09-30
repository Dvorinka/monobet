// Minigame payout math — shared between the /games UI (odds display) and the
// server actions that settle rounds. No secrets here; tokens live in actions.

export const GAME_LEVERAGES = [1, 2, 3, 5, 10, 25, 50, 100] as const;

// A dealer persona fronts every minigame — configured in admin; avatar may be
// an image URL/data URI (rendered as a picture) or a short monogram.
export type Persona = { id?: string; name: string; avatar: string; quipWin: string; quipLose: string };

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
// Longer targets pay more — holding a hidden count for 30s is harder.
export const TIMER_TARGETS = [5000, 10000, 15000, 30000] as const;
export const TIMER_REVEAL_MS = 2000;
export const TIMER_TIERS = [
  { errMs: 150, mult: 6 },
  { errMs: 350, mult: 2.5 },
  { errMs: 700, mult: 1.4 },
] as const;
export const TIMER_TARGET_MULT: Record<number, number> = {
  5000: 1,
  10000: 1.5,
  15000: 2,
  30000: 3,
};
export function timerMult(errMs: number, targetMs: number) {
  const tier = TIMER_TIERS.find((t) => errMs <= t.errMs)?.mult ?? 0;
  return tier * (TIMER_TARGET_MULT[targetMs] ?? 1);
}
// Max multiplier for a target — shown in the UI as the payout ceiling.
export function timerTopMult(targetMs: number) {
  return timerMult(0, targetMs);
}
// Digits stay visible for 40% of the target (capped at 8s) — longer targets
// get a proportionally longer pacing window.
export function timerRevealMs(targetMs: number) {
  return Math.min(targetMs * 0.4, 8000);
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

// Slots: three reels drawn from a weighted 5-symbol strip (18 slots).
// Triples pay the table below; a lone pair refunds 80% of the stake.
// RTP ≈ 0.42 (triples) + 0.44 (pairs) ≈ 0.86.
export const SLOT_SYMBOLS = ["Ɱ", "7", "★", "◆", "♣"] as const;
export const SLOT_WEIGHTS = [1, 2, 4, 5, 6] as const;
export const SLOT_TRIPLE = [40, 20, 10, 6, 4] as const;
export const SLOT_PAIR = 0.8;
export const SLOT_TOTAL_WEIGHT = SLOT_WEIGHTS.reduce((a, b) => a + b, 0);
export function slotDraw(r: number) {
  let acc = 0;
  for (let i = 0; i < SLOT_WEIGHTS.length; i++) {
    acc += SLOT_WEIGHTS[i];
    if (r < acc) return i;
  }
  return SLOT_WEIGHTS.length - 1;
}
export function slotPayout(a: number, b: number, c: number) {
  if (a === b && b === c) return SLOT_TRIPLE[a];
  return a === b || b === c || a === c ? SLOT_PAIR : 0;
}

// Blackjack — single 52-card shoe, ints 0-51 (rank = v % 13, suit = v / 13).
// Dealer stands on all 17. Blackjack pays 2.5×, a regular win 2×, push refunds.
export const BJ_WIN_MULT = 2;
export const BJ_NATURAL_MULT = 2.5;

export const BJ_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const BJ_SUITS = ["♠", "♥", "♦", "♣"] as const;
export function cardLabel(v: number) {
  return { rank: BJ_RANKS[v % 13], suit: BJ_SUITS[Math.floor(v / 13)], red: Math.floor(v / 13) === 1 || Math.floor(v / 13) === 2 };
}

// Hand total with aces as 11→1 fallback; `soft` = an ace still counts as 11.
export function handTotal(cards: number[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const r = c % 13;
    if (r === 0) aces++;
    else total += r >= 9 ? 10 : r + 1;
  }
  total += aces * 11;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}
export const isNatural = (cards: number[]) => cards.length === 2 && handTotal(cards).total === 21;
