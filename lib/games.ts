// Minigame payout math — shared between the /games UI (odds display) and the
// server actions that settle rounds. No secrets here; tokens live in actions.

export const GAME_LEVERAGES = [1, 2, 3, 5, 10, 25, 50, 100] as const;
// Notional sanity cap — the stake times leverage can't exceed this.
export const MAX_GAME_WAGER_CENTS = 100_000_00;
// Minigame session pacing: a stake opens a 30 min window; when it lapses the
// games lock for a 30 min break, then a fresh window opens on the next stake.
export const GAME_SESSION_MS = 30 * 60_000;
export const GAME_BREAK_MS = 30 * 60_000;

// A dealer persona fronts every minigame — configured in admin; avatar may be
// an image URL/data URI (rendered as a picture) or a short monogram.
export type Persona = { id?: string; name: string; avatar: string; quipWin: string; quipLose: string };

// Special personas keyed by name — admin can add/remove dealers freely, but
// these names carry behavior: a win overlay ("splash"/"plane"/"pride"/"shekel"),
// a rigged table (rigged dealers flip player wins into losses), or a blessed
// table (blessed dealers flip losses into wins by Wall prayer count).
export type DealerFx = { winFx?: "splash" | "plane" | "pride" | "shekel"; rigged?: boolean; blessed?: boolean };
export function dealerFx(p?: Persona | null): DealerFx {
  const n = p?.name.toLowerCase().replace(/[^a-z.]/g, "") ?? "";
  if (n === "bonnieblue") return { winFx: "splash" };
  if (n === "j.epst." || n === "jepst" || n === "j.epst") return { winFx: "plane", rigged: true };
  if (n === "clavicular") return { winFx: "pride" };
  if (n === "bibi" || n === "netanyahu") return { winFx: "shekel", blessed: true };
  return {};
}

// Bibi's blessing — a losing round under his table flips to a win with a
// chance that grows with prayers left at the Wall of Debts. Capped so the
// house never deals a sure thing.
export const BLESS_BASE_PCT = 6;
export const BLESS_PER_PRAYER_PCT = 6;
export const BLESS_MAX_PCT = 48;
export function blessedChancePct(prayers: number): number {
  return Math.min(BLESS_MAX_PCT, BLESS_BASE_PCT + Math.max(0, prayers) * BLESS_PER_PRAYER_PCT);
}

// Tel Aviv bonus — a won round under Bibi forgives a slice of house debt,
// at most once per window. The ledger (kind "tav") is the source of truth.
export const TAV_BONUS_PCT = 0.067;
export const TAV_COOLDOWN_MS = 12 * 3600_000;

// The Wall of Debts — a sacrificial relief mechanic. A prayer burns a candle
// fee (min Ɱ25 or 2% of the debt, whichever is steeper) and clears a small
// random slice; sometimes the wall stays silent and keeps the fee anyway.
// Vows pledge a share of every win to the debt until it's gone.
export const WALL_COOLDOWN_MS = 6 * 3600_000;
export const WALL_FEE_MIN_CENTS = 2_500;
export const WALL_FEE_DEBT_PCT = 0.02;
export const WALL_CLEAR_MIN_PCT = 0.02;
export const WALL_CLEAR_MAX_PCT = 0.15;
export const WALL_SILENT_PCT = 15; // % of prayers the wall ignores
export const WALL_MIRACLE_PER_MILLE = 15; // ‰ of answered prayers that clear all debt
// A wordless slip is an insult, not a prayer — the candle burns anyway and
// the wall answers by growing the debt.
export const WALL_BACKFIRE_PCT = 0.05;
// Prayers that name the holy land move the stones more often: half the
// silence, quadruple the miracles, a deeper slice of forgiveness.
export const WALL_BLESSED_RE = /israel|israeli|tel\s?-?aviv|netanyahu|bibi|zion|jerusalem|shalom|holy\s?land|mossad|shekel|kosher|promised\s?land/i;
export const WALL_BLESSED_SILENT_PCT = 9;
export const WALL_BLESSED_MIRACLE_PER_MILLE = 60;
export const WALL_BLESSED_CLEAR_MAX_PCT = 0.35;
export const VOW_CHOICES_BPS = [0, 1000, 2000, 3000]; // 0/10/20/30% of wins

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
export const TIMER_TARGETS = [2000, 3000, 5000, 10000, 15000, 30000] as const;
export const TIMER_REVEAL_MS = 2000;
export const TIMER_TIERS = [
  { errMs: 100, mult: 2.5 },
  { errMs: 250, mult: 1 },
  { errMs: 500, mult: 0.8 },
] as const;
export const TIMER_TARGET_MULT: Record<number, number> = {
  2000: 0.5,
  3000: 0.6,
  5000: 0.8,
  10000: 1,
  15000: 1.35,
  30000: 1.8,
};
export function timerMult(errMs: number, targetMs: number) {
  const tier = TIMER_TIERS.find((t) => errMs <= t.errMs)?.mult ?? 0;
  return tier * (TIMER_TARGET_MULT[targetMs] ?? 1);
}
// Max multiplier for a target — shown in the UI as the payout ceiling.
export function timerTopMult(targetMs: number) {
  return timerMult(0, targetMs);
}
// Digits stay visible for 30% of the target (capped at 5s) — longer targets
// get a proportionally longer pacing window.
export function timerRevealMs(targetMs: number) {
  return Math.min(targetMs * 0.3, 5000);
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

// Plinko — a ball falls through 12 rows of pins, each bounce 50/50 left/right,
// and lands in one of 13 pockets. Edges pay the most; the table is symmetric
// and unimodal, so "nudge toward the middle" always lowers the payout (rig)
// and "nudge outward" always raises it (bless/luck). RTP ≈ 95.9%.
export const PLINKO_ROWS = 12;
export const PLINKO_MULT = [40, 11, 3.7, 1.8, 0.9, 0.6, 0.5, 0.6, 0.9, 1.8, 3.7, 11, 40] as const;
export const PLINKO_CENTER = PLINKO_ROWS / 2;
export function plinkoBucket(path: number[]) {
  return path.reduce((a, step) => a + (step ? 1 : 0), 0);
}
// Rebuild a valid path for a given pocket — used when rig/luck moves the
// landing, so the replayed animation still matches the settled outcome.
export function plinkoPathForBucket(bucket: number, rand: (n: number) => number) {
  const order = Array.from({ length: PLINKO_ROWS }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const rights = new Set(order.slice(0, bucket));
  return Array.from({ length: PLINKO_ROWS }, (_, i) => (rights.has(i) ? 1 : 0));
}

// Duels — claim is the classic agreed bet; the rest are server-resolved
// minigames where both sides make one move and the better result takes the
// pot. Game rounds are free; only the locked stake is real money.
export const DUEL_KINDS = ["claim", "rps", "roll", "wheel", "slots", "plinko"] as const;
export type DuelKind = (typeof DUEL_KINDS)[number];
export const RPS_MOVES = ["rock", "paper", "scissors"] as const;
export type RpsMove = (typeof RPS_MOVES)[number];
// rock > scissors > paper > rock — index beats (index + 1) % 3 loses
export const RPS_BEATS: Record<RpsMove, RpsMove> = { rock: "scissors", paper: "rock", scissors: "paper" };
// Game kinds carry a canonical English label as their claim text — the panel
// localizes the label from `kind`, ledger memos just need something readable.
export const DUEL_NAMES: Record<DuelKind, string> = {
  claim: "Custom bet",
  rps: "Rock Paper Scissors",
  roll: "High roll",
  wheel: "Wheel spin",
  slots: "Slots draw",
  plinko: "Plinko drop",
};

// Slots: three reels drawn from a weighted 5-symbol strip (18 slots).
// Triples pay the table below; a lone pair is a push — stake back.
// P(triple) ≈ 7%, P(pair) ≈ 55% → RTP ≈ 0.42 (triples) + 0.55 (pairs) ≈ 0.97.
export const SLOT_SYMBOLS = ["Ɱ", "7", "★", "◆", "♣"] as const;
export const SLOT_WEIGHTS = [1, 2, 4, 5, 6] as const;
export const SLOT_TRIPLE = [40, 20, 10, 6, 4] as const;
export const SLOT_PAIR = 1;
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

// Blackjack — 4-deck shoe, ints 0-207 (rank = v % 13, suit = floor(v/13) % 4).
// Dealer stands on all 17. Blackjack pays 2.5×, a regular win 2×, push refunds.
export const BJ_DECKS = 4;
export const BJ_WIN_MULT = 2;
export const BJ_NATURAL_MULT = 2.5;

export const BJ_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const BJ_SUITS = ["♠", "♥", "♦", "♣"] as const;
export function cardLabel(v: number) {
  const suit = Math.floor(v / 13) % 4;
  return { rank: BJ_RANKS[v % 13], suit: BJ_SUITS[suit], red: suit === 1 || suit === 2 };
}
const cardSuit = (v: number) => Math.floor(v / 13) % 4;

// Side bets — stake returns `mult`× on a hit, nothing on a miss.
export type SideWin = { label: string; mult: number } | null;

// Perfect Pairs on the player's first two cards.
export function evalPerfectPairs(player: number[]): SideWin {
  if (player.length !== 2 || player[0] % 13 !== player[1] % 13) return null;
  const s0 = cardSuit(player[0]);
  const s1 = cardSuit(player[1]);
  if (s0 === s1) return { label: "ppPerfect", mult: 30 };
  const red = (s: number) => s === 1 || s === 2;
  return red(s0) === red(s1) ? { label: "ppColored", mult: 12 } : { label: "ppMixed", mult: 6 };
}

// 21+3: the player's two cards plus the dealer up-card as a poker hand.
export function evalTwentyOnePlusThree(player: number[], dealerUp: number): SideWin {
  if (player.length !== 2) return null;
  const ranks = [player[0] % 13, player[1] % 13, dealerUp % 13].sort((a, b) => a - b);
  const suits = [cardSuit(player[0]), cardSuit(player[1]), cardSuit(dealerUp)];
  const flush = suits[0] === suits[1] && suits[1] === suits[2];
  const trips = ranks[0] === ranks[1] && ranks[1] === ranks[2];
  const straight = (ranks[1] === ranks[0] + 1 && ranks[2] === ranks[1] + 1) || (ranks[0] === 0 && ranks[1] === 11 && ranks[2] === 12);
  if (flush && trips) return { label: "t3Suited", mult: 100 };
  if (flush && straight) return { label: "t3SF", mult: 40 };
  if (trips) return { label: "t3Trips", mult: 30 };
  if (straight) return { label: "t3Straight", mult: 10 };
  if (flush) return { label: "t3Flush", mult: 5 };
  return null;
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
