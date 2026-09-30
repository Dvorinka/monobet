"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Card, Segmented } from "@/components/ui/primitives";
import {
  playCoinFlip,
  playDice,
  startTimerRound,
  stopTimerRound,
  playLimbo,
  playWheel,
  playSlots,
  blackjackDeal,
  blackjackHit,
  blackjackStand,
  blackjackDouble,
  blackjackSurrender,
} from "@/lib/actions";
import { levFeeCents, levWinCents, LEV_FEE_BPS } from "@/lib/liq";
import {
  GAME_LEVERAGES,
  MAX_GAME_WAGER_CENTS,
  COINFLIP_MULT,
  diceMult,
  diceWinChance,
  TIMER_TARGETS,
  timerRevealMs,
  timerTopMult,
  LIMBO_MIN,
  LIMBO_MAX,
  limboWinChance,
  WHEEL_SEGMENTS,
  WHEEL_STEP,
  SLOT_SYMBOLS,
  SLOT_TRIPLE,
  BJ_NATURAL_MULT,
  cardLabel,
  dealerFx,
} from "@/lib/games";
import { fmtMonos } from "@/lib/money";
import { DealerAvatar } from "@/components/dealer-avatar";
import { type DealerFx, type Persona } from "@/lib/games";
import { playSfx } from "@/lib/sfx";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Coins, Dices, Timer, Rocket, Disc3, Cherry, Spade, Shuffle, X } from "lucide-react";

type Net = { netCents: number; won: boolean; stamp: number; feeCents?: number; stakeCents?: number; skimCents?: number } | null;

function useGame(lang?: Lang) {
  const t = getT(lang ?? "en");
  const [pending, start] = useTransition();
  const router = useRouter();
  // Known server error strings -> localized text; anything else passes through.
  const errText = (msg?: string) =>
    msg === "Insufficient balance"
      ? t.errInsufficient
      : msg === "Minimum bet is Ɱ 1"
        ? t.errMinBet
        : msg === "Bet too large"
          ? t.errBetTooLarge
          : msg?.startsWith("Too fast")
            ? t.errTooFast
            : msg ?? "Error";
  const run = <T extends { ok: boolean; error?: string }>(fn: () => Promise<T>): Promise<T | null> =>
    new Promise((resolve) =>
      start(async () => {
        const r = await fn();
        if (!r.ok) {
          toast.error(errText(r.error));
          resolve(null);
          return;
        }
        router.refresh();
        resolve(r);
      })
    );
  return { pending, run };
}

// Shared result flash — pops in with the net win/loss.
function ResultTag({ net, lang }: { net: Net; lang?: Lang }) {
  useEffect(() => {
    if (net) playSfx(net.won ? "win" : "lose", 0.5);
  }, [net]);
  if (!net) return null;
  const t = getT(lang ?? "en");
  // Headline = the win itself (stake + profit, before any debt garnish). A
  // debtor's profit may route to their loan, so a separate line shows what
  // actually landed on the balance — otherwise "+stake back" reads as
  // "won what I bet".
  const gross = net.netCents + (net.stakeCents ?? 0) + (net.feeCents ?? 0);
  const skim = net.skimCents ?? 0;
  const sub =
    net.won && net.stakeCents
      ? t.gameProfit(`+${fmtMonos(net.netCents + skim, { lang })}`)
      : !net.won && gross > 0
        ? t.gameReturned(fmtMonos(gross, { lang }))
        : null;
  return (
    <div key={net.stamp} className="anim-win-pop num">
      <div className={cn("text-[15px] font-bold", net.won ? "text-yes-strong" : "text-no-strong")}>
        {net.won ? `+${fmtMonos(gross + skim, { lang })}` : `−${fmtMonos(-net.netCents, { lang })}`}
        <span className="ml-1.5 text-[11px] font-semibold text-mute">{net.won ? t.win : t.lose}</span>
        {(net.feeCents ?? 0) > 0 && (
          <span className="ml-1.5 rounded-full border border-no/40 bg-no-soft px-1.5 py-0.5 text-[10px] font-bold text-no-strong align-middle">
            {t.gameFeeChip(fmtMonos(net.feeCents!, { lang }))}
          </span>
        )}
      </div>
      {sub && <div className="text-[11px] font-semibold text-mute">{sub}</div>}
      {skim > 0 && (
        <>
          <div className="text-[11px] font-semibold text-mute">{t.debtGarnish(fmtMonos(skim, { lang }))}</div>
          <div className="text-[11px] font-semibold text-yes-strong">{t.gameCredited(`+${fmtMonos(gross, { lang })}`)}</div>
        </>
      )}
    </div>
  );
}

// The persona hosting the round — name shows while it plays, quip on settle.
function DealerTag({ dealer, won }: { dealer: Persona | null; won?: boolean | null }) {
  if (!dealer) return null;
  const quip = won == null ? null : won ? dealer.quipLose : dealer.quipWin;
  return (
    <div className="flex items-center justify-center gap-1.5 text-[11px] text-faint">
      <DealerAvatar avatar={dealer.avatar} className="size-4.5 rounded" />
      <span className="font-semibold text-mute">{dealer.name}</span>
      {quip && <span className="italic">“{quip}”</span>}
    </div>
  );
}


// Debtors play unleveraged — the display value is pinned to 1x so the ticket
// preview matches what the server will accept.
function lockedLev(lev: string, inDebt?: boolean) {
  return inDebt ? "1" : lev;
}

type WinFx = NonNullable<DealerFx["winFx"]>;

// Dealer win FX — some personas celebrate a player win with a full-screen
// moment (Bonnie's splash, Epstein's plane, Clavicular's parade). Name-keyed
// via dealerFx.
function dealerWinFx(dealer: Persona | null | undefined, won: boolean, netCents: number, cb?: (amt: number, fx: WinFx, tavCents?: number) => void, tavCents?: number) {
  const fx = dealerFx(dealer).winFx;
  if (won && netCents > 0 && fx) cb?.(netCents, fx, tavCents);
}

// Ɱ amount input + quick chips + leverage row — shared by every game card.
function BetControls({
  bet,
  setBet,
  lev,
  setLev,
  balanceCents,
  disabled,
  locked,
  lang,
  sideUnits,
  winPreview,
}: {
  bet: string;
  setBet: (v: string) => void;
  lev: string;
  setLev: (v: string) => void;
  balanceCents: number;
  disabled?: boolean;
  locked?: boolean;
  lang?: Lang;
  sideUnits?: number;
  // Multiplier a win pays — `max` marks a ceiling (variable-outcome games).
  // Shown lever-adjusted so the leverage's real effect is visible.
  winPreview?: { mult: number; max?: boolean };
}) {
  const t = getT(lang ?? "en");
  const betCents = Math.round(parseFloat(bet || "0") * 100);
  const levN = Number(lev);
  const sides = sideUnits ?? 0;
  const fee = levFeeCents(betCents, levN);
  const atRisk = betCents * (1 + sides) + fee;
  // Max stake: balance must cover stake units + the funding fee, and the
  // borrowed notional stays under the house cap.
  const maxCents = Math.min(
    Math.floor(balanceCents / (1 + sides + ((levN - 1) * LEV_FEE_BPS) / 10_000)),
    Math.floor(MAX_GAME_WAGER_CENTS / levN)
  );
  return (
    <div className="space-y-2">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mute font-semibold text-sm">Ɱ</span>
        <input
          type="number"
          min="0"
          step="1"
          value={bet}
          disabled={disabled}
          onChange={(e) => setBet(e.target.value)}
          placeholder="0"
          className="num h-10 w-full rounded-lg border border-line bg-surface pl-8 pr-9 text-[14px] font-semibold text-ink placeholder:text-faint focus:outline-2 focus:outline-brand disabled:opacity-50"
        />
        {bet !== "" && !disabled && (
          <button
            type="button"
            onClick={() => setBet("")}
            title={t.clearInput}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 size-5 grid place-items-center rounded-full bg-surface-3 text-mute hover:text-ink hover:bg-line cursor-pointer"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      <div className="flex gap-1.5">
        {[10, 50, 100].map((v) => (
          <button
            key={v}
            disabled={disabled}
            onClick={() => setBet(String((parseFloat(bet || "0") + v).toFixed(0)))}
            className="flex-1 h-6.5 rounded-md bg-surface-2 text-[11.5px] font-semibold text-mute hover:bg-surface-3 hover:text-ink cursor-pointer disabled:opacity-50"
          >
            +{v}
          </button>
        ))}
        <button
          disabled={disabled}
          onClick={() => setBet(String(Math.max(0, Math.floor(maxCents / 100))))}
          className="flex-1 h-6.5 rounded-md bg-surface-2 text-[11.5px] font-semibold text-mute hover:bg-surface-3 hover:text-ink cursor-pointer disabled:opacity-50"
        >
          {t.max}
        </button>
      </div>
      <div>
        <div className="flex items-center justify-between text-[12px] font-medium text-mute mb-1">
          <span>{t.leverage}</span>
          <span className="num">{t.atRisk} {fmtMonos(atRisk, { lang })}</span>
        </div>
        <Segmented
          options={GAME_LEVERAGES.map((v) => ({ value: String(v), label: `${v}×` }))}
          value={lev}
          onChange={setLev}
          disabled={locked}
        />
        {levN > 1 && !locked && (
          <p className="mt-1.5 text-[11.5px] text-faint">{t.levFeeNote(fmtMonos(fee, { lang }))}</p>
        )}
        {winPreview && betCents > 0 && (
          <p className="mt-1.5 text-[11.5px] font-medium text-yes-strong">
            {(winPreview.max ? t.winUpTo : t.winPays)(
              fmtMonos(levWinCents(betCents, levN, winPreview.mult), { lang })
            )}
          </p>
        )}
        {locked && <p className="mt-1.5 text-[11.5px] font-medium text-no-strong">{t.levLocked}</p>}
      </div>
    </div>
  );
}

function GameCard({
  icon,
  title,
  sub,
  stage,
  controls,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  stage: React.ReactNode;
  controls: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("p-5 flex flex-col gap-4", className)}>
      <div className="flex items-center gap-2.5">
        <span className="size-9 rounded-xl bg-brand-soft text-brand-strong grid place-items-center shrink-0">{icon}</span>
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-tight leading-tight">{title}</div>
          <div className="text-[11.5px] text-faint leading-tight mt-0.5">{sub}</div>
        </div>
      </div>
      <div className="grid place-items-center min-h-[120px] rounded-xl bg-surface-2/60 border border-line-2 py-4">
        {stage}
      </div>
      {controls}
    </Card>
  );
}

// ---------- coin flip ----------

type GameProps = { balanceCents: number; lang?: Lang; dealerId?: string; inDebt?: boolean; onWinFx?: (amt: number, fx: WinFx, tavCents?: number) => void };

function CoinFlipCard({ balanceCents, lang, dealerId, inDebt, onWinFx }: GameProps) {
  const t = getT(lang ?? "en");
  const { pending, run } = useGame(lang);
  const [pick, setPick] = useState<"heads" | "tails">("heads");
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [rot, setRot] = useState(0);
  const [net, setNet] = useState<Net>(null);
  const [spinning, setSpinning] = useState(false);
  const [dealer, setDealer] = useState<Persona | null>(null);

  const flip = () => {
    const bc = Math.round(parseFloat(bet || "0") * 100);
    run(() => playCoinFlip({ dealerId, betCents: bc, leverage: Number(lockedLev(lev, inDebt)), pick })).then(
      (r) => {
        if (!r || !r.landed) return;
        playSfx("flip", 0.5);
        setNet(null);
        setDealer(r.dealer ?? null);
        setSpinning(true);
        // Land heads on a full rotation, tails on a half — always ≥5 turns.
        setRot((prev) => Math.ceil((prev + 1) / 360) * 360 + 4 * 360 + (r.landed === "tails" ? 180 : 0));
        setTimeout(() => {
          setSpinning(false);
          setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won: !!r.won, feeCents: r.feeCents, stakeCents: bc, skimCents: r.skimCents });
          dealerWinFx(r.dealer, !!r.won, (r.netCents ?? 0) + bc + (r.feeCents ?? 0) + (r.skimCents ?? 0), onWinFx, r.tavCents);
        }, 1150);
      }
    );
  };

  return (
    <GameCard
      icon={<Coins className="size-4.5" />}
      title={t.gCoinFlip}
      sub={t.gCoinFlipSub}
      stage={
        <div className="flex flex-col items-center gap-3" style={{ perspective: 500 }}>
          <div
            className="relative size-[76px]"
            style={{
              transform: `rotateX(${rot}deg)`,
              transformStyle: "preserve-3d",
              transition: "transform 1.1s cubic-bezier(0.2, 0.7, 0.25, 1)",
            }}
          >
            <div
              className="absolute inset-0 rounded-full grid place-items-center text-[26px] font-black bg-brand text-brand-on shadow-[0_3px_10px_rgba(15,157,88,0.35)]"
              style={{ backfaceVisibility: "hidden" }}
            >
              Ɱ
            </div>
            <div
              className="absolute inset-0 rounded-full grid place-items-center text-[26px] font-black bg-ink text-surface"
              style={{ backfaceVisibility: "hidden", transform: "rotateX(180deg)" }}
            >
              ✕
            </div>
          </div>
          <ResultTag net={spinning ? null : net} lang={lang} />
          <DealerTag dealer={dealer} won={spinning ? null : net?.won} />
        </div>
      }
      controls={
        <>
          <Segmented
            options={[
              { value: "heads", label: t.heads },
              { value: "tails", label: t.tails },
            ]}
            value={pick}
            onChange={(v) => setPick(v)}
          />
          <BetControls bet={bet} setBet={setBet} lev={lockedLev(lev, inDebt)} setLev={setLev} balanceCents={balanceCents} locked={inDebt} disabled={pending || spinning} lang={lang} winPreview={{ mult: COINFLIP_MULT }} />
          <Button className="w-full" size="lg" disabled={pending || spinning || !parseFloat(bet)} onClick={flip}>
            {spinning ? t.flipping : t.flip}
          </Button>
        </>
      }
    />
  );
}

// ---------- dice ----------

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function DiceFace({ value, rolling }: { value: number; rolling: boolean }) {
  return (
    <div className={cn("size-[72px] rounded-2xl bg-ink grid grid-cols-3 gap-1.5 p-3 shadow-[0_3px_10px_rgba(0,0,0,0.18)]", rolling && "anim-dice-shake")}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={cn("rounded-full transition-colors", PIPS[value].includes(i) ? "bg-surface" : "bg-transparent")} />
      ))}
    </div>
  );
}

function DiceCard({ balanceCents, lang, dealerId, inDebt, onWinFx }: GameProps) {
  const t = getT(lang ?? "en");
  const { pending, run } = useGame(lang);
  const [over, setOver] = useState(3);
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [face, setFace] = useState(6);
  const [rolling, setRolling] = useState(false);
  const [net, setNet] = useState<Net>(null);
  const [dealer, setDealer] = useState<Persona | null>(null);

  const roll = () => {
    const bc = Math.round(parseFloat(bet || "0") * 100);
    setRolling(true);
    setNet(null);
    setDealer(null);
    playSfx("roll", 0.45);
    const cyc = setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 70);
    run(() => playDice({ dealerId, betCents: bc, leverage: Number(lockedLev(lev, inDebt)), over })).then((r) => {
      if (r?.dealer) setDealer(r.dealer);
      setTimeout(() => {
        clearInterval(cyc);
        setRolling(false);
        if (r?.roll) {
          setFace(r.roll);
          setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won: !!r.won, feeCents: r.feeCents, stakeCents: bc, skimCents: r.skimCents });
          dealerWinFx(r.dealer, !!r.won, (r.netCents ?? 0) + bc + (r.feeCents ?? 0) + (r.skimCents ?? 0), onWinFx, r.tavCents);
        }
      }, 650);
    });
  };

  return (
    <GameCard
      icon={<Dices className="size-4.5" />}
      title={t.gDice}
      sub={t.gDiceSub}
      stage={
        <div className="flex flex-col items-center gap-3">
          <DiceFace value={face} rolling={rolling} />
          <ResultTag net={rolling ? null : net} lang={lang} />
          <DealerTag dealer={dealer} won={rolling ? null : net?.won} />
        </div>
      }
      controls={
        <>
          <div>
            <div className="flex items-center justify-between text-[12px] font-medium text-mute mb-1">
              <span>{t.rollOver(over)}</span>
              <span className="num">
                {Math.round(diceWinChance(over) * 100)}% · {diceMult(over).toFixed(2)}×
              </span>
            </div>
            <input
              type="range"
              min={2}
              max={5}
              step={1}
              value={over}
              onChange={(e) => setOver(Number(e.target.value))}
              className="w-full accent-brand cursor-pointer"
            />
          </div>
          <BetControls bet={bet} setBet={setBet} lev={lockedLev(lev, inDebt)} setLev={setLev} balanceCents={balanceCents} locked={inDebt} disabled={pending || rolling} lang={lang} winPreview={{ mult: diceMult(over) }} />
          <Button className="w-full" size="lg" disabled={pending || rolling || !parseFloat(bet)} onClick={roll}>
            {rolling ? t.rolling : t.roll}
          </Button>
        </>
      }
    />
  );
}

// ---------- stop the timer ----------

function TimerCard({ balanceCents, lang, dealerId, inDebt, onWinFx }: GameProps) {
  const t = getT(lang ?? "en");
  const { pending, run } = useGame(lang);
  const [target, setTarget] = useState("10");
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [disp, setDisp] = useState(0);
  const [err, setErr] = useState<number | null>(null);
  const [net, setNet] = useState<Net>(null);
  const [dealer, setDealer] = useState<Persona | null>(null);
  const tokenRef = useRef<string | null>(null);
  const t0 = useRef(0);
  const targetMs = Number(target) * 1000;

  const hidden = phase === "running" && disp > timerRevealMs(targetMs);

  // Audible cue the moment the digits hide.
  const wasHidden = useRef(false);
  useEffect(() => {
    if (hidden && !wasHidden.current) playSfx("trade", 0.25);
    wasHidden.current = hidden;
  }, [hidden]);

  // Display ticker — runs while the round is live; impure clock stays inside
  // an effect where the purity rule allows it.
  useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(() => setDisp(performance.now() - t0.current), 30);
    return () => clearInterval(id);
  }, [phase]);

  const start = () =>
    run(() => startTimerRound({ targetMs: Number(target) * 1000 })).then((r) => {
      if (!r?.token) return;
      tokenRef.current = r.token;
      setNet(null);
      setDealer(null);
      setErr(null);
      setDisp(0);
      t0.current = performance.now();
      setPhase("running");
    });

  const stop = () => {
    const token = tokenRef.current;
    if (!token) return;
    const bc = Math.round(parseFloat(bet || "0") * 100);
    run(() =>
      stopTimerRound({ dealerId, token, betCents: bc, leverage: Number(lockedLev(lev, inDebt)) })
    ).then((r) => {
      setPhase("done");
      if (!r) return;
      setDisp(r.elapsedMs ?? 0);
      setErr(r.errMs ?? null);
      setDealer(r.dealer ?? null);
      setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won: !!r.won, feeCents: r.feeCents, stakeCents: bc, skimCents: r.skimCents });
      dealerWinFx(r.dealer, !!r.won, (r.netCents ?? 0) + bc + (r.feeCents ?? 0) + (r.skimCents ?? 0), onWinFx, r.tavCents);
    });
  };

  return (
    <GameCard
      icon={<Timer className="size-4.5" />}
      title={t.gTimer}
      sub={t.gTimerSub}
      stage={
        <div className="flex flex-col items-center gap-2">
          <div
            className={cn(
              "num text-[44px] font-black tracking-tight leading-none tabular-nums",
              hidden && "anim-shimmer text-faint"
            )}
          >
            {hidden ? "?.??" : (disp / 1000).toFixed(2)}
            <span className="text-[18px] font-bold text-mute">s</span>
          </div>
          <div className="text-[12px] text-faint">
            {phase === "running" ? (hidden ? t.guessNow : t.memorize) : phase === "done" && err !== null ? t.offBy(err) : t.targetIs(`${target}.00s`)}
          </div>
          <ResultTag net={phase === "done" ? net : null} lang={lang} />
          <DealerTag dealer={dealer} won={phase === "done" ? net?.won : null} />
        </div>
      }
      controls={
        <>
          <div>
            <Segmented
              options={TIMER_TARGETS.map((ms) => ({ value: String(ms / 1000), label: `${ms / 1000}s` }))}
              value={target}
              onChange={setTarget}
              disabled={phase === "running"}
            />
            <div className="mt-1 text-right text-[11px] font-medium text-faint num">
              {t.paysUpTo(timerTopMult(targetMs).toFixed(0))}
            </div>
          </div>
          <BetControls bet={bet} setBet={setBet} lev={lockedLev(lev, inDebt)} setLev={setLev} balanceCents={balanceCents} locked={inDebt} disabled={pending || phase === "running"} lang={lang} winPreview={{ mult: timerTopMult(targetMs), max: true }} />
          {phase === "running" ? (
            <Button className="w-full" size="lg" variant="no" disabled={pending} onClick={stop}>
              {t.stop}
            </Button>
          ) : (
            <Button className="w-full" size="lg" disabled={pending || !parseFloat(bet)} onClick={start}>
              {t.start}
            </Button>
          )}
        </>
      }
    />
  );
}

// ---------- limbo ----------

function LimboCard({ balanceCents, lang, dealerId, inDebt, onWinFx }: GameProps) {
  const t = getT(lang ?? "en");
  const { pending, run } = useGame(lang);
  const [target, setTarget] = useState(2);
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [shown, setShown] = useState(1);
  const [busy, setBusy] = useState(false);
  const [wonLast, setWonLast] = useState<boolean | null>(null);
  const [net, setNet] = useState<Net>(null);
  const [dealer, setDealer] = useState<Persona | null>(null);
  const raf = useRef(0);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const play = () => {
    const bc = Math.round(parseFloat(bet || "0") * 100);
    run(() => playLimbo({ dealerId, betCents: bc, leverage: Number(lockedLev(lev, inDebt)), target })).then(
      (r) => {
        if (r?.roll == null) return;
        const roll = r.roll;
        playSfx("launch", 0.4);
        setBusy(true);
        setNet(null);
        setDealer(r.dealer ?? null);
        setWonLast(null);
        const start = performance.now();
        const dur = Math.min(1400, 500 + Math.log2(roll) * 140);
        const step = () => {
          const p = Math.min(1, (performance.now() - start) / dur);
          setShown(1 + (roll - 1) * (1 - Math.pow(1 - p, 3)));
          if (p < 1) raf.current = requestAnimationFrame(step);
          else {
            setBusy(false);
            setWonLast(!!r.won);
            setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won: !!r.won, feeCents: r.feeCents, stakeCents: bc, skimCents: r.skimCents });
            dealerWinFx(r.dealer, !!r.won, (r.netCents ?? 0) + bc + (r.feeCents ?? 0) + (r.skimCents ?? 0), onWinFx, r.tavCents);
          }
        };
        raf.current = requestAnimationFrame(step);
      }
    );
  };

  // Bar scale: log from 1 to 50 — where most rounds land.
  const barPct = Math.min(100, (Math.log(shown) / Math.log(50)) * 100);
  const targetPct = (Math.log(target) / Math.log(50)) * 100;

  return (
    <GameCard
      icon={<Rocket className="size-4.5" />}
      title={t.gLimbo}
      sub={t.gLimboSub}
      stage={
        <div className="w-full flex flex-col items-center gap-3 px-2">
          <div
            className={cn(
              "num text-[40px] font-black leading-none tabular-nums",
              wonLast === true && "text-yes-strong",
              wonLast === false && "text-no-strong"
            )}
          >
            {shown.toFixed(2)}×
          </div>
          <div className="relative w-full h-3.5 rounded-full bg-surface-3 overflow-hidden">
            <div
              className={cn(
                "absolute inset-y-0 left-0 rounded-full transition-none",
                wonLast === false ? "bg-no" : "bg-brand"
              )}
              style={{ width: `${Math.max(4, barPct)}%` }}
            />
            <div
              className="absolute inset-y-0 w-0.5 bg-ink"
              style={{ left: `${targetPct}%` }}
            />
          </div>
          <ResultTag net={busy ? null : net} lang={lang} />
          <DealerTag dealer={dealer} won={busy ? null : net?.won} />
        </div>
      }
      controls={
        <>
          <div>
            <div className="flex items-center justify-between text-[12px] font-medium text-mute mb-1">
              <span>{t.targetX(target.toFixed(2))}</span>
              <span className="num">
                {(limboWinChance(target) * 100).toFixed(1)}% · {(target * 0.98).toFixed(2)}×
              </span>
            </div>
            <input
              type="range"
              min={LIMBO_MIN}
              max={LIMBO_MAX}
              step={0.05}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
              className="w-full accent-brand cursor-pointer"
            />
          </div>
          <BetControls bet={bet} setBet={setBet} lev={lockedLev(lev, inDebt)} setLev={setLev} balanceCents={balanceCents} locked={inDebt} disabled={pending || busy} lang={lang} winPreview={{ mult: target * 0.98 }} />
          <Button className="w-full" size="lg" disabled={pending || busy || !parseFloat(bet)} onClick={play}>
            {busy ? t.launching : t.launch}
          </Button>
        </>
      }
    />
  );
}

// ---------- wheel ----------

// Wedge color by payout tier — dead wedges stay muted, the 5× jackpot glows.
function wheelColor(m: number, i: number) {
  if (m <= 0) return "var(--color-surface-3)";
  if (m >= 5) return "#f59e0b";
  if (m >= 2) return "var(--color-yes)";
  return i % 2 ? "var(--color-brand-strong)" : "var(--color-brand)";
}

function WheelCard({ balanceCents, lang, dealerId, inDebt, onWinFx }: GameProps) {
  const t = getT(lang ?? "en");
  const { pending, run } = useGame(lang);
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [rot, setRot] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState<number | null>(null);
  const [net, setNet] = useState<Net>(null);
  const [dealer, setDealer] = useState<Persona | null>(null);

  const spin = () => {
    const bc = Math.round(parseFloat(bet || "0") * 100);
    run(() => playWheel({ dealerId, betCents: bc, leverage: Number(lockedLev(lev, inDebt)) })).then((r) => {
      if (r?.index == null) return;
      playSfx("spin", 0.5);
      setNet(null);
      setDealer(r.dealer ?? null);
      setLanded(null);
      setSpinning(true);
      // Land segment `index` under the top pointer, plus ~6 full turns.
      const want = 360 - (r.index * WHEEL_STEP + WHEEL_STEP / 2);
      setRot((prev) => prev + 6 * 360 + (((want - (prev % 360)) % 360) + 360) % 360);
      setTimeout(() => {
        setSpinning(false);
        setLanded(r.mult ?? null);
        // 0.5×/0.6×/0.8× segments return part of the stake — still a loss.
        setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won: (r.netCents ?? 0) > 0, feeCents: r.feeCents, stakeCents: bc, skimCents: r.skimCents });
        dealerWinFx(r.dealer, (r.netCents ?? 0) > 0, (r.netCents ?? 0) + bc + (r.feeCents ?? 0) + (r.skimCents ?? 0), onWinFx, r.tavCents);
      }, 3250);
    });
  };

  const segs = WHEEL_SEGMENTS.map((m, i) => `${wheelColor(m, i)} ${i * WHEEL_STEP}deg ${(i + 1) * WHEEL_STEP}deg`).join(", ");

  return (
    <GameCard
      icon={<Disc3 className="size-4.5" />}
      title={t.gWheel}
      sub={t.gWheelSub}
      stage={
        <div className="relative flex flex-col items-center gap-3 pt-3">
          <div
            className="absolute top-0 z-20 size-0 border-x-[11px] border-t-[18px] border-x-transparent drop-shadow-sm"
            style={{ borderTopColor: "var(--color-ink)" }}
          />
          {/* static rim + rotating disc inside */}
          <div className="relative size-[196px] rounded-full bg-ink p-[7px] shadow-[0_8px_28px_rgba(0,0,0,0.22)] ring-1 ring-line-2">
            <div
              className="relative size-full rounded-full overflow-hidden"
              style={{
                background: `conic-gradient(${segs})`,
                transform: `rotate(${rot}deg)`,
                transition: "transform 3.2s cubic-bezier(0.12, 0.85, 0.15, 1)",
              }}
            >
              {WHEEL_SEGMENTS.map((_, i) => (
                <div key={`sep${i}`} className="absolute inset-0" style={{ transform: `rotate(${i * WHEEL_STEP}deg)` }}>
                  <div className="absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2 bg-white/25" />
                </div>
              ))}
              {WHEEL_SEGMENTS.map((m, i) => (
                <div key={i} className="absolute inset-0" style={{ transform: `rotate(${i * WHEEL_STEP + WHEEL_STEP / 2}deg)` }}>
                  <span
                    className="absolute left-1/2 top-2.5 -translate-x-1/2 text-[11px] font-black tracking-tight"
                    style={{ color: m > 0 ? "var(--color-yes-on)" : "var(--color-faint)" }}
                  >
                    {m > 0 ? `${m}×` : "—"}
                  </span>
                </div>
              ))}
              <div
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.22), transparent 55%)" }}
              />
            </div>
            <div className="absolute inset-0 m-auto z-10 size-11 rounded-full bg-surface border-[3px] border-line grid place-items-center text-[15px] font-black text-ink shadow-md">
              Ɱ
            </div>
          </div>
          <div className="min-h-5 flex items-center justify-center gap-2">
            {landed !== null && !spinning && (
              <span className="num text-[12px] font-bold text-mute anim-win-pop">{landed}×</span>
            )}
            <ResultTag net={spinning ? null : net} lang={lang} />
          </div>
          <DealerTag dealer={dealer} won={spinning ? null : net?.won} />
        </div>
      }
      controls={
        <>
          <BetControls bet={bet} setBet={setBet} lev={lockedLev(lev, inDebt)} setLev={setLev} balanceCents={balanceCents} locked={inDebt} disabled={pending || spinning} lang={lang} winPreview={{ mult: Math.max(...WHEEL_SEGMENTS), max: true }} />
          <Button className="w-full" size="lg" disabled={pending || spinning || !parseFloat(bet)} onClick={spin}>
            {spinning ? t.spinning : t.spin}
          </Button>
        </>
      }
    />
  );
}

// ---------- slots ----------

function SlotsCard({ balanceCents, lang, dealerId, inDebt, onWinFx }: GameProps) {
  const t = getT(lang ?? "en");
  const { pending, run } = useGame(lang);
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [reels, setReels] = useState([0, 1, 2]);
  const [settled, setSettled] = useState([true, true, true]);
  const [spinning, setSpinning] = useState(false);
  const [net, setNet] = useState<Net>(null);
  const [dealer, setDealer] = useState<Persona | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () =>
      () =>
        timers.current.forEach((id) => {
          clearTimeout(id);
          clearInterval(id);
        }),
    []
  );

  const spin = () => {
    const bc = Math.round(parseFloat(bet || "0") * 100);
    run(() => playSlots({ dealerId, betCents: bc, leverage: Number(lockedLev(lev, inDebt)) })).then(
      (r) => {
        if (!r?.reels) return;
        playSfx("roll", 0.45);
        setNet(null);
        setDealer(r.dealer ?? null);
        setSpinning(true);
        setSettled([false, false, false]);
        // Reels settle left to right; each cycles symbols until its turn.
        r.reels.forEach((sym, i) => {
          const cyc = setInterval(
            () =>
              setReels((prev) => {
                const n = [...prev];
                n[i] = Math.floor(Math.random() * SLOT_SYMBOLS.length);
                return n;
              }),
            80
          );
          timers.current.push(cyc);
          timers.current.push(
            setTimeout(
              () => {
                clearInterval(cyc);
                setReels((prev) => {
                  const n = [...prev];
                  n[i] = sym;
                  return n;
                });
                setSettled((prev) => {
                  const n = [...prev];
                  n[i] = true;
                  return n;
                });
                playSfx("trade", 0.2);
              },
              700 + i * 350
            )
          );
        });
        timers.current.push(
          setTimeout(() => {
            setSpinning(false);
            setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won: (r.netCents ?? 0) > 0, feeCents: r.feeCents, stakeCents: bc, skimCents: r.skimCents });
            dealerWinFx(r.dealer, (r.netCents ?? 0) > 0, (r.netCents ?? 0) + bc + (r.feeCents ?? 0) + (r.skimCents ?? 0), onWinFx, r.tavCents);
          }, 700 + r.reels.length * 350 + 150)
        );
      }
    );
  };

  const won = net?.won === true;
  return (
    <GameCard
      icon={<Cherry className="size-4.5" />}
      title={t.gSlots}
      sub={t.gSlotsSub}
      stage={
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-2.5">
            {reels.map((s, i) => (
              <div
                key={i}
                className={cn(
                  "size-16 rounded-xl grid place-items-center text-[26px] font-black border",
                  settled[i]
                    ? won
                      ? "bg-brand-soft border-brand/40 text-brand-strong"
                      : "bg-surface border-line text-ink"
                    : "bg-surface-2 border-line-2 text-mute animate-pulse"
                )}
              >
                {SLOT_SYMBOLS[s]}
              </div>
            ))}
          </div>
          <ResultTag net={spinning ? null : net} lang={lang} />
          <DealerTag dealer={dealer} won={spinning ? null : net?.won} />
        </div>
      }
      controls={
        <>
          <BetControls bet={bet} setBet={setBet} lev={lockedLev(lev, inDebt)} setLev={setLev} balanceCents={balanceCents} locked={inDebt} disabled={pending || spinning} lang={lang} winPreview={{ mult: SLOT_TRIPLE[0], max: true }} />
          <Button className="w-full" size="lg" disabled={pending || spinning || !parseFloat(bet)} onClick={spin}>
            {spinning ? t.spinning : t.spin}
          </Button>
        </>
      }
    />
  );
}

// ---------- blackjack ----------
// Interactive hand against an automated dealer persona — the shoe lives
// server-side; the client only sends deal/hit/stand.

type BjSide = { stake: number; winCents: number; label: string | null };

type BjRound = {
  roundId: string;
  player: number[];
  dealer: number[];
  dealerHidden: boolean;
  playerTotal: number;
  dealerTotal: number | null;
  persona: { name: string; avatar: string; quipWin: string; quipLose: string };
  status: string;
  result?: string | null;
  netCents?: number | null;
  betCents?: number;
  feeCents?: number;
  skimCents?: number;
  tavCents?: number;
  sides?: Record<string, BjSide> | null;
  doubled?: boolean;
};

function PlayingCard({ v, hidden }: { v?: number; hidden?: boolean }) {
  if (hidden || v === undefined)
    return (
      <div className="w-10 h-14 rounded-md border border-line bg-ink p-1 shadow-sm">
        <div className="h-full w-full rounded-[3px] bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.14)_0px,rgba(255,255,255,0.14)_2px,transparent_2px,transparent_6px)]" />
      </div>
    );
  const c = cardLabel(v);
  return (
    <div
      className={cn(
        "w-10 h-14 rounded-md border border-line bg-surface grid grid-rows-[auto_1fr] px-1 pt-0.5 shadow-sm anim-win-pop",
        c.red ? "text-no-strong" : "text-ink"
      )}
    >
      <span className="num text-[12px] font-bold leading-none">{c.rank}</span>
      <span className="text-[15px] leading-none self-center justify-self-center">{c.suit}</span>
    </div>
  );
}

function BlackjackCard({ balanceCents, lang, dealerId, inDebt, onWinFx }: GameProps) {
  const t = getT(lang ?? "en");
  const { pending, run } = useGame(lang);
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [pp, setPp] = useState(false);
  const [t3, setT3] = useState(false);
  const [round, setRound] = useState<BjRound | null>(null);
  const [net, setNet] = useState<Net>(null);

  const settle = (s?: BjRound) => {
    if (!s || s.status !== "settled") return;
    const won = s.result === "win" || s.result === "blackjack";
    playSfx(won ? "win" : "lose", 0.5);
    setNet({ stamp: Date.now(), netCents: s.netCents ?? 0, won, feeCents: s.feeCents, stakeCents: s.betCents, skimCents: s.skimCents });
    dealerWinFx(s.persona, won, (s.netCents ?? 0) + (s.betCents ?? 0) + (s.feeCents ?? 0) + (s.skimCents ?? 0), onWinFx, s.tavCents);
  };

  const deal = () =>
    run(() => blackjackDeal({ dealerId, betCents: Math.round(parseFloat(bet || "0") * 100), leverage: Number(lockedLev(lev, inDebt)), sides: { pp, t3 } })).then((r) => {
      if (!r?.state) return;
      playSfx("flip", 0.4);
      setNet(null);
      setRound(r.state);
      settle(r.state);
    });

  const hit = () =>
    run(() => blackjackHit({ roundId: round!.roundId })).then((r) => {
      if (!r?.state) return;
      playSfx("trade", 0.3);
      setRound(r.state);
      settle(r.state);
    });

  const stand = () =>
    run(() => blackjackStand({ roundId: round!.roundId })).then((r) => {
      if (!r?.state) return;
      setRound(r.state);
      settle(r.state);
    });

  const double = () =>
    run(() => blackjackDouble({ roundId: round!.roundId })).then((r) => {
      if (!r?.state) return;
      playSfx("trade", 0.3);
      setRound(r.state);
      settle(r.state);
    });

  const surrender = () =>
    run(() => blackjackSurrender({ roundId: round!.roundId })).then((r) => {
      if (!r?.state) return;
      setRound(r.state);
      settle(r.state);
    });

  const playing = round?.status === "playing";
  const firstMove = playing && round!.player.length === 2 && !round!.doubled;
  const settledRound = round?.status === "settled" ? round : null;
  const resultLabel =
    settledRound?.result === "blackjack"
      ? t.bjNatural
      : settledRound?.result === "push"
        ? t.bjPush
        : settledRound?.result === "win"
          ? t.bjYouWin
          : settledRound?.result === "surrender"
            ? t.bjSurrendered
            : settledRound?.result === "lose"
              ? (round?.playerTotal ?? 0) > 21
                ? t.bjBust
                : t.bjDealerWins
              : null;
  const quip = settledRound
    ? settledRound.result === "lose" || settledRound.result === "surrender"
      ? settledRound.persona.quipWin
      : settledRound.persona.quipLose
    : null;

  return (
    <GameCard
      icon={<Spade className="size-4.5" />}
      title={t.gBlackjack}
      sub={round ? round.persona.name : t.gBlackjackSub}
      stage={
        <div className="w-full flex flex-col items-center gap-3 px-1">
          {/* dealer row */}
          <div className="w-full">
            <div className="flex items-center gap-2 mb-1.5">
              <DealerAvatar avatar={round?.persona.avatar ?? ""} className="size-6" />
              <span className="text-[12px] font-semibold text-mute">{round?.persona.name ?? t.gBlackjack}</span>
              {round?.dealerTotal != null && <span className="num ml-auto text-[12px] font-bold">{round.dealerTotal}</span>}
            </div>
            <div className="flex gap-1.5 flex-wrap min-h-14">
              {round
                ? round.dealer.map((c, i) => <PlayingCard key={i} v={c} />).concat(round.dealerHidden ? [<PlayingCard key="h" hidden />] : [])
                : <PlayingCard hidden />}
            </div>
          </div>
          {/* player row */}
          <div className="w-full">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[12px] font-semibold text-mute">{lang === "cs" ? "Vy" : "You"}</span>
              {/* funding fee paid at deal — visible for the whole hand */}
              {playing && (round.feeCents ?? 0) > 0 && (
                <span className="num text-[10.5px] font-medium text-faint">{t.gameFeeChip(fmtMonos(round.feeCents!, { lang }))}</span>
              )}
              {round && <span className="num ml-auto text-[12px] font-bold">{round.playerTotal}</span>}
            </div>
            <div className="flex gap-1.5 flex-wrap min-h-14">
              {round ? round.player.map((c, i) => <PlayingCard key={i} v={c} />) : <PlayingCard hidden />}
            </div>
          </div>
          {/* side-bet results — resolved the moment the cards land */}
          {round?.sides && Object.keys(round.sides).length > 0 && (
            <div className="flex gap-1.5 flex-wrap justify-center">
              {(["pp", "t3"] as const).map((k) => {
                const s = round.sides![k];
                if (!s) return null;
                return (
                  <span
                    key={k}
                    className={cn(
                      "num inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold",
                      s.winCents > 0 ? "bg-yes-soft text-yes-strong" : "bg-surface-2 text-faint"
                    )}
                  >
                    {k === "pp" ? "PP" : "21+3"}
                    {s.winCents > 0 ? ` ${t[s.label as keyof typeof t] as string} +${fmtMonos(s.winCents, { lang })}` : " —"}
                  </span>
                );
              })}
            </div>
          )}
          <div className="min-h-5 flex flex-col items-center gap-0.5">
            {resultLabel && <span className="text-[12.5px] font-bold anim-win-pop">{resultLabel}</span>}
            {quip && <span className="text-[11.5px] text-faint italic">“{quip}”</span>}
            <ResultTag net={net} lang={lang} />
          </div>
        </div>
      }
      controls={
        <>
          {!playing && (
            <>
              <BetControls bet={bet} setBet={setBet} lev={lockedLev(lev, inDebt)} setLev={setLev} balanceCents={balanceCents} locked={inDebt} disabled={pending} lang={lang} sideUnits={(pp ? 1 : 0) + (t3 ? 1 : 0)} winPreview={{ mult: BJ_NATURAL_MULT, max: true }} />
              <div className="flex gap-1.5">
                {([
                  { on: pp, set: setPp, name: "PP", desc: t.bjSidePP },
                  { on: t3, set: setT3, name: "21+3", desc: t.bjSide21 },
                ] as const).map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => s.set(!s.on)}
                    disabled={pending}
                    className={cn(
                      "flex-1 h-8 rounded-lg border text-[11.5px] font-semibold transition-all cursor-pointer inline-flex items-center justify-center gap-1",
                      s.on
                        ? "border-brand bg-brand-soft text-brand-strong"
                        : "border-line bg-surface-2 text-mute hover:text-ink"
                    )}
                    title={s.desc}
                  >
                    {s.name}
                    {/* each side bet costs a full stake */}
                    <span className={cn("num text-[10px] font-semibold", s.on ? "text-brand-strong/70" : "text-faint")}>
                      +{fmtMonos(Math.round(parseFloat(bet || "0") * 100), { lang, decimals: false })}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {playing ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-2">
                <Button className="flex-1" size="lg" disabled={pending} onClick={hit}>
                  {t.bjHit}
                </Button>
                <Button className="flex-1" size="lg" variant="outline" disabled={pending} onClick={stand}>
                  {t.bjStand}
                </Button>
              </div>
              {firstMove && (
                <div className="flex gap-2">
                  <Button className="flex-1" size="sm" variant="outline" disabled={pending} onClick={double}>
                    {t.bjDouble}
                  </Button>
                  <Button className="flex-1" size="sm" variant="ghost" disabled={pending} onClick={surrender}>
                    {t.bjSurrender}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <Button className="w-full" size="lg" disabled={pending || !parseFloat(bet)} onClick={deal}>
              {round ? t.bjNewHand : t.bjDeal}
            </Button>
          )}
        </>
      }
    />
  );
}

export const GAME_COMPONENTS = {
  coinflip: CoinFlipCard,
  dice: DiceCard,
  timer: TimerCard,
  limbo: LimboCard,
  wheel: WheelCard,
  slots: SlotsCard,
  blackjack: BlackjackCard,
} as const;

export type GameSlug = keyof typeof GAME_COMPONENTS;

// Bonnie Blue win easter egg — a cream pie hits mid-screen: one irregular
// splat with radiating fingers and stray droplets, then the mass sticks and
// slides down off the screen.
function BonnieSplash({ amountCents, lang }: { amountCents: number; lang?: Lang }) {
  const t = getT(lang ?? "en");
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-hidden pointer-events-none" role="status" aria-live="polite">
      <div className="anim-pie-out relative" style={{ width: "44vmin", height: "44vmin" }}>
        <svg aria-hidden viewBox="0 0 100 100" className="anim-pie-in absolute inset-0 w-full h-full" style={{ filter: "drop-shadow(0 16px 34px rgba(60,45,15,0.28))" }}>
          <g fill="#f7f1e3">
            <ellipse cx="48" cy="52" rx="31" ry="26" transform="rotate(-8 48 52)" />
            <ellipse cx="52" cy="20" rx="6" ry="14" transform="rotate(6 52 20)" />
            <ellipse cx="77" cy="33" rx="5" ry="12" transform="rotate(50 77 33)" />
            <ellipse cx="80" cy="63" rx="6" ry="15" transform="rotate(84 80 63)" />
            <ellipse cx="62" cy="82" rx="5" ry="13" transform="rotate(164 62 82)" />
            <ellipse cx="27" cy="76" rx="6" ry="11" transform="rotate(212 27 76)" />
            <ellipse cx="17" cy="41" rx="5" ry="13" transform="rotate(282 17 41)" />
            <ellipse cx="38" cy="16" rx="4" ry="9" transform="rotate(330 38 16)" />
            <circle cx="89" cy="17" r="3.4" /><circle cx="10" cy="70" r="3" /><circle cx="72" cy="92" r="2.6" /><circle cx="15" cy="12" r="2.8" /><circle cx="92" cy="53" r="2.4" />
          </g>
        </svg>
        <div className="anim-pie-in relative h-full grid place-items-center text-center px-6">
          <div>
            <div className="text-[13px] font-bold uppercase tracking-[0.2em] text-[#6b5a33]">{t.bonnieWin}</div>
            <div className="num text-5xl font-black text-[#3d3119] mt-1">+{fmtMonos(amountCents, { lang })}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// J. EPST. win easter egg — the jet crosses over the island's aerial photo
// (pushing in like a chase cam), then nose-dives into the hillside; the
// flash blooms at the impact point before the scene fades.
function JetSvg() {
  return (
    <svg aria-hidden viewBox="0 0 440 140" className="anim-plane-crash absolute left-0 top-0 w-[34vmin] min-w-44" style={{ filter: "drop-shadow(0 10px 18px rgba(0,0,0,.45))" }}>
      <defs>
        <linearGradient id="epst-fus" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".55" stopColor="#eef1f6" />
          <stop offset="1" stopColor="#b9c2d0" />
        </linearGradient>
        <linearGradient id="epst-wing" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6eaf1" />
          <stop offset="1" stopColor="#aab4c4" />
        </linearGradient>
        <linearGradient id="epst-eng" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2f4f8" />
          <stop offset="1" stopColor="#9aa6b8" />
        </linearGradient>
      </defs>
      <path d="M236 78 L168 116 L196 118 L262 82 Z" fill="#8d99ac" />
      <path d="M18 60 C18 44 42 34 92 30 L332 24 C376 22 414 34 428 52 C434 60 430 68 414 72 L96 82 C50 84 18 76 18 60 Z" fill="url(#epst-fus)" />
      <path d="M22 56 C30 36 46 16 64 8 L78 8 L62 36 L52 58 Z" fill="url(#epst-fus)" />
      <path d="M40 52 L20 40 L30 38 L56 48 Z" fill="#c3ccda" />
      <path d="M58 46 L104 42 C112 42 114 52 106 56 L62 62 C52 62 50 50 58 46 Z" fill="url(#epst-eng)" />
      <ellipse cx="104" cy="49" rx="5" ry="6" fill="#3a4556" />
      <path d="M250 74 L176 124 L210 126 L286 78 Z" fill="url(#epst-wing)" />
      <path d="M356 32 L392 38 L398 48 L366 46 Z" fill="#22303f" />
      <path d="M348 34 L356 33 L362 46 L352 45 Z" fill="#22303f" />
      <g fill="#2a3a4d">
        {[330, 308, 286, 264, 242, 220, 198, 176, 154].map((x, i) => (
          <ellipse key={x} cx={x} cy={44 + i} rx="4.5" ry="4" />
        ))}
      </g>
      <rect x="394" y="40" width="2.5" height="22" rx="1" fill="#c0c8d4" opacity=".8" />
      <path d="M30 68 C120 74 300 70 410 60 L410 64 C300 74 120 78 34 72 Z" fill="#cfd6e2" opacity=".7" />
    </svg>
  );
}

function PlaneSplash({ amountCents, lang }: { amountCents: number; lang?: Lang }) {
  const t = getT(lang ?? "en");
  return (
    <div className="anim-plane-veil fixed inset-0 z-[100] overflow-hidden bg-[#0b1d33]" role="status" aria-live="polite">
      <div
        aria-hidden
        className="anim-island-zoom absolute -inset-[4%] bg-cover bg-center"
        style={{ backgroundImage: "url(/fx/island.webp)" }}
      />
      <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(115% 85% at 50% 42%, transparent 52%, rgba(6,16,30,.55) 100%)" }} />
      <JetSvg />
      <div
        aria-hidden
        className="anim-crash-flash absolute rounded-full"
        style={{
          left: "58%",
          top: "52%",
          width: "32vmin",
          height: "32vmin",
          translate: "-50% -50%",
          background: "radial-gradient(closest-side, #fff7d6 0%, #fbbf24 40%, rgba(249,115,22,0.55) 68%, transparent 72%)",
        }}
      />
      <div className="relative h-full grid place-items-center">
        <div className="anim-win-pop text-center px-6 [text-shadow:0_2px_18px_rgba(0,0,0,.65)]">
          <div className="text-[13px] font-bold uppercase tracking-[0.2em] text-white/80">{t.bonnieWin}</div>
          <div className="num text-5xl font-black text-white mt-1">+{fmtMonos(amountCents, { lang })}</div>
        </div>
      </div>
    </div>
  );
}

// Clavicular win easter egg — a pride parade floods the screen: the flag
// ripples stripe-by-stripe like cloth while confetti rains over the payout.
const PRIDE_STRIPES = ["#e40303", "#ff8c00", "#ffed00", "#008026", "#24408e", "#732982"] as const;
const CONFETTI_COLORS = [...PRIDE_STRIPES, "#ff69b4", "#5bcffa", "#ffffff"] as const;
// Fixed seeds — deterministic, no per-render randomness.
const CONFETTI = Array.from({ length: 42 }, (_, i) => ({
  x: (i * 37 + 11) % 100,
  d: (i * 97) % 900,
  s: 5 + ((i * 13) % 7),
  c: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  drift: ((i * 29) % 40) - 20,
}));

function PrideSplash({ amountCents, lang }: { amountCents: number; lang?: Lang }) {
  const t = getT(lang ?? "en");
  return (
    <div className="anim-pride-veil fixed inset-0 z-[100] overflow-hidden pointer-events-none" role="status" aria-live="polite">
      <div aria-hidden className="absolute -inset-x-[12%] -inset-y-[8%] flex flex-col" style={{ transform: "rotate(-3deg)" }}>
        {PRIDE_STRIPES.map((c, i) => (
          <div key={c} className="anim-pride-stripe flex-1" style={{ background: c, animationDelay: `${i * 110}ms` }} />
        ))}
      </div>
      <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 50% 46%, transparent 40%, rgba(20,7,31,.5) 100%)" }} />
      {CONFETTI.map((c, i) => (
        <div
          key={i}
          aria-hidden
          className="anim-confetti absolute -top-3 rounded-[1px]"
          style={{
            left: `${c.x}%`,
            width: c.s,
            height: Math.round(c.s * 1.7),
            background: c.c,
            animationDelay: `${c.d}ms`,
            ["--drift" as string]: `${c.drift}px`,
          }}
        />
      ))}
      <div className="relative h-full grid place-items-center">
        <div className="anim-win-pop text-center px-6 [text-shadow:0_2px_18px_rgba(0,0,0,.65)]">
          <div className="text-[13px] font-bold uppercase tracking-[0.2em] text-white/85">{t.bonnieWin}</div>
          <div className="num text-5xl font-black text-white mt-1">+{fmtMonos(amountCents, { lang })}</div>
        </div>
      </div>
    </div>
  );
}

// Bibi win easter egg — the flag behind, shekel notes raining down, and the
// man himself dancing over the payout. Fixed seeds — deterministic rain.
const SHEKEL_GIF = "https://media1.tenor.com/m/FD0RSSUxM9gAAAAd/benjamin-netanyahu-epstein.gif";
const MONEY_RAIN = Array.from({ length: 56 }, (_, i) => ({
  x: (i * 41 + 7) % 100,
  d: (i * 131) % 1100,
  s: 14 + ((i * 17) % 18),
  drift: ((i * 23) % 60) - 30,
  o: 0.55 + ((i * 29) % 45) / 100,
}));

function ShekelSplash({ amountCents, tavCents, lang }: { amountCents: number; tavCents?: number; lang?: Lang }) {
  const t = getT(lang ?? "en");
  return (
    <div className="anim-shekel-veil fixed inset-0 z-[100] overflow-hidden pointer-events-none bg-[#f4f7ff]" role="status" aria-live="polite">
      {/* the flag — blue bands on a white field, star faint behind it all */}
      <div aria-hidden className="absolute inset-x-0 top-[12%] h-[13%] bg-[#0038b8]" />
      <div aria-hidden className="absolute inset-x-0 bottom-[12%] h-[13%] bg-[#0038b8]" />
      <svg aria-hidden viewBox="0 0 100 100" className="absolute left-1/2 top-1/2 w-[42vmin] -translate-x-1/2 -translate-y-1/2 opacity-[0.12]">
        <g fill="none" stroke="#0038b8" strokeWidth="5">
          <path d="M50 14 L82 68 L18 68 Z" />
          <path d="M50 86 L18 32 L82 32 Z" />
        </g>
      </svg>
      {/* money rain */}
      {MONEY_RAIN.map((m, i) => (
        <span
          key={i}
          aria-hidden
          className="anim-money absolute -top-8 font-black text-[#0a7d2c] select-none"
          style={{
            left: `${m.x}%`,
            fontSize: m.s,
            opacity: m.o,
            animationDelay: `${m.d}ms`,
            ["--drift" as string]: `${m.drift}px`,
            textShadow: "0 1px 2px rgba(255,255,255,.7)",
          }}
        >
          ₪
        </span>
      ))}
      <div className="relative h-full grid place-items-center">
        <div className="anim-gif-pop text-center px-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- user-provided remote gif */}
          <img
            src={SHEKEL_GIF}
            alt=""
            className="mx-auto w-48 sm:w-60 rounded-xl shadow-[0_18px_50px_rgba(0,30,90,.45)] border-4 border-white/90"
          />
          <div className="mt-4 [text-shadow:0_2px_14px_rgba(255,255,255,.9)]">
            <div className="text-[13px] font-bold uppercase tracking-[0.2em] text-[#0038b8]/80">{t.bonnieWin}</div>
            <div className="num text-5xl font-black text-[#0a3d1a] mt-1">+{fmtMonos(amountCents, { lang })}</div>
            {tavCents ? (
              <div className="num mt-2 inline-block rounded-full bg-white/90 px-3 py-1 text-sm font-bold text-[#0038b8] shadow-sm">{t.tavBonus(fmtMonos(tavCents, { lang }))}</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function GameView({
  game,
  balanceCents,
  lang,
  dealers,
  inDebt,
}: {
  game: GameSlug;
  balanceCents: number;
  lang?: Lang;
  dealers?: (Persona & { id: string })[];
  inDebt?: boolean;
}) {
  const t = getT(lang ?? "en");
  const Game = GAME_COMPONENTS[game];
  const [dealerId, setDealerId] = useState<string>();
  const [splash, setSplash] = useState<{ amt: number; fx: WinFx; tav?: number } | null>(null);
  useEffect(() => {
    if (splash == null) return;
    const id = setTimeout(() => setSplash(null), 2600);
    return () => clearTimeout(id);
  }, [splash]);
  const cardCls = (on: boolean) =>
    cn(
      "flex items-center gap-3 rounded-xl border p-3 text-left cursor-pointer transition-colors",
      on ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-mute"
    );
  return (
    <div>
      {dealers && dealers.length > 0 && (
        <div className="mb-4">
          <div className="text-[12px] font-semibold text-mute mb-1.5">{t.dealerPick}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <button type="button" onClick={() => setDealerId(undefined)} className={cardCls(dealerId == null)}>
              <span className={cn("size-11 grid place-items-center rounded-lg", dealerId == null ? "bg-brand-soft" : "bg-surface-2")}>
                <Shuffle className="size-5 text-mute" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-ink truncate">{t.dealerRandom}</span>
                <span className="block text-[11px] text-mute truncate">{t.dealerRandomHint}</span>
              </span>
            </button>
            {dealers.map((d) => {
              const fx = dealerFx(d);
              return (
                <button type="button" key={d.id} onClick={() => setDealerId(d.id)} className={cardCls(dealerId === d.id)}>
                  <DealerAvatar avatar={d.avatar} className="size-11 rounded-lg shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-bold text-ink truncate">{d.name}</span>
                    {d.quipWin && <span className="block text-[11px] leading-snug text-mute line-clamp-2 italic">“{d.quipWin}”</span>}
                    {(fx.rigged || fx.blessed) && (
                      <span className="mt-1 flex gap-1">
                        {fx.rigged && <span className="rounded-full bg-no-soft px-1.5 py-px text-[9.5px] font-bold text-no-strong uppercase tracking-wide">{t.dealerRigged}</span>}
                        {fx.blessed && <span className="rounded-full bg-yes-soft px-1.5 py-px text-[9.5px] font-bold text-yes-strong uppercase tracking-wide">{t.dealerBlessed}</span>}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <Game balanceCents={balanceCents} lang={lang} dealerId={dealerId} inDebt={inDebt}
        onWinFx={(amt, fx, tav) => setSplash({ amt, fx, tav })} />
      {splash?.fx === "splash" && <BonnieSplash amountCents={splash.amt} lang={lang} />}
      {splash?.fx === "plane" && <PlaneSplash amountCents={splash.amt} lang={lang} />}
      {splash?.fx === "pride" && <PrideSplash amountCents={splash.amt} lang={lang} />}
      {splash?.fx === "shekel" && <ShekelSplash amountCents={splash.amt} tavCents={splash.tav} lang={lang} />}
    </div>
  );
}
