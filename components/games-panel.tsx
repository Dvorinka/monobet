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
} from "@/lib/actions";
import {
  GAME_LEVERAGES,
  diceMult,
  diceWinChance,
  TIMER_TARGETS,
  TIMER_REVEAL_MS,
  LIMBO_MIN,
  LIMBO_MAX,
  limboWinChance,
  WHEEL_SEGMENTS,
  WHEEL_STEP,
} from "@/lib/games";
import { fmtMarks } from "@/lib/money";
import { playSfx } from "@/lib/sfx";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Coins, Dices, Timer, Rocket, Disc3 } from "lucide-react";

type Net = { netCents: number; won: boolean; stamp: number } | null;

function useGame() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = <T extends { ok: boolean; error?: string }>(fn: () => Promise<T>): Promise<T | null> =>
    new Promise((resolve) =>
      start(async () => {
        const r = await fn();
        if (!r.ok) {
          toast.error(r.error);
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
  return (
    <div
      key={net.stamp}
      className={cn(
        "anim-win-pop num text-[15px] font-bold",
        net.won ? "text-yes-strong" : "text-no-strong"
      )}
    >
      {net.won ? `+${fmtMarks(net.netCents, { lang })}` : `−${fmtMarks(-net.netCents, { lang })}`}
      <span className="ml-1.5 text-[11px] font-semibold text-mute">{net.won ? t.win : t.lose}</span>
    </div>
  );
}

// Ɱ amount input + quick chips + leverage row — shared by every game card.
function BetControls({
  bet,
  setBet,
  lev,
  setLev,
  balanceCents,
  disabled,
  lang,
}: {
  bet: string;
  setBet: (v: string) => void;
  lev: string;
  setLev: (v: string) => void;
  balanceCents: number;
  disabled?: boolean;
  lang?: Lang;
}) {
  const t = getT(lang ?? "en");
  const wager = Math.round(parseFloat(bet || "0") * 100) * Number(lev);
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
          className="num h-10 w-full rounded-lg border border-line bg-surface pl-8 pr-3 text-[14px] font-semibold text-ink placeholder:text-faint focus:outline-2 focus:outline-brand disabled:opacity-50"
        />
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
          onClick={() => setBet(String(Math.floor(balanceCents / 100 / Number(lev))))}
          className="flex-1 h-6.5 rounded-md bg-surface-2 text-[11.5px] font-semibold text-mute hover:bg-surface-3 hover:text-ink cursor-pointer disabled:opacity-50"
        >
          {t.max}
        </button>
      </div>
      <div>
        <div className="flex items-center justify-between text-[12px] font-medium text-mute mb-1">
          <span>{t.leverage}</span>
          <span className="num">{t.atRisk} {fmtMarks(wager, { lang })}</span>
        </div>
        <Segmented
          options={GAME_LEVERAGES.map((v) => ({ value: String(v), label: `${v}×` }))}
          value={lev}
          onChange={setLev}
        />
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

function CoinFlipCard({ balanceCents, lang }: { balanceCents: number; lang?: Lang }) {
  const t = getT(lang ?? "en");
  const { pending, run } = useGame();
  const [pick, setPick] = useState<"heads" | "tails">("heads");
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [rot, setRot] = useState(0);
  const [net, setNet] = useState<Net>(null);
  const [spinning, setSpinning] = useState(false);

  const flip = () =>
    run(() => playCoinFlip({ betCents: Math.round(parseFloat(bet || "0") * 100), leverage: Number(lev), pick })).then(
      (r) => {
        if (!r || !r.landed) return;
        setNet(null);
        setSpinning(true);
        // Land heads on a full rotation, tails on a half — always ≥5 turns.
        setRot((prev) => Math.ceil((prev + 1) / 360) * 360 + 4 * 360 + (r.landed === "tails" ? 180 : 0));
        setTimeout(() => {
          setSpinning(false);
          setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won: !!r.won });
        }, 1150);
      }
    );

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
          <BetControls bet={bet} setBet={setBet} lev={lev} setLev={setLev} balanceCents={balanceCents} disabled={pending || spinning} lang={lang} />
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

function DiceCard({ balanceCents, lang }: { balanceCents: number; lang?: Lang }) {
  const t = getT(lang ?? "en");
  const { pending, run } = useGame();
  const [over, setOver] = useState(3);
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [face, setFace] = useState(6);
  const [rolling, setRolling] = useState(false);
  const [net, setNet] = useState<Net>(null);

  const roll = () => {
    setRolling(true);
    setNet(null);
    const cyc = setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 70);
    run(() => playDice({ betCents: Math.round(parseFloat(bet || "0") * 100), leverage: Number(lev), over })).then((r) => {
      setTimeout(() => {
        clearInterval(cyc);
        setRolling(false);
        if (r?.roll) {
          setFace(r.roll);
          setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won: !!r.won });
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
          <BetControls bet={bet} setBet={setBet} lev={lev} setLev={setLev} balanceCents={balanceCents} disabled={pending || rolling} lang={lang} />
          <Button className="w-full" size="lg" disabled={pending || rolling || !parseFloat(bet)} onClick={roll}>
            {rolling ? t.rolling : t.roll}
          </Button>
        </>
      }
    />
  );
}

// ---------- stop the timer ----------

function TimerCard({ balanceCents, lang }: { balanceCents: number; lang?: Lang }) {
  const t = getT(lang ?? "en");
  const { pending, run } = useGame();
  const [target, setTarget] = useState("10");
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [disp, setDisp] = useState(0);
  const [err, setErr] = useState<number | null>(null);
  const [net, setNet] = useState<Net>(null);
  const tokenRef = useRef<string | null>(null);
  const t0 = useRef(0);

  const hidden = phase === "running" && disp > TIMER_REVEAL_MS;

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
      setErr(null);
      setDisp(0);
      t0.current = performance.now();
      setPhase("running");
    });

  const stop = () => {
    const token = tokenRef.current;
    if (!token) return;
    run(() =>
      stopTimerRound({ token, betCents: Math.round(parseFloat(bet || "0") * 100), leverage: Number(lev) })
    ).then((r) => {
      setPhase("done");
      if (!r) return;
      setDisp(r.elapsedMs ?? 0);
      setErr(r.errMs ?? null);
      setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won: !!r.won });
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
        </div>
      }
      controls={
        <>
          <Segmented
            options={TIMER_TARGETS.map((ms) => ({ value: String(ms / 1000), label: `${ms / 1000}s` }))}
            value={target}
            onChange={setTarget}
          />
          <BetControls bet={bet} setBet={setBet} lev={lev} setLev={setLev} balanceCents={balanceCents} disabled={pending || phase === "running"} lang={lang} />
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

function LimboCard({ balanceCents, lang }: { balanceCents: number; lang?: Lang }) {
  const t = getT(lang ?? "en");
  const { pending, run } = useGame();
  const [target, setTarget] = useState(2);
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [shown, setShown] = useState(1);
  const [busy, setBusy] = useState(false);
  const [wonLast, setWonLast] = useState<boolean | null>(null);
  const [net, setNet] = useState<Net>(null);
  const raf = useRef(0);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const play = () =>
    run(() => playLimbo({ betCents: Math.round(parseFloat(bet || "0") * 100), leverage: Number(lev), target })).then(
      (r) => {
        if (r?.roll == null) return;
        const roll = r.roll;
        setBusy(true);
        setNet(null);
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
            setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won: !!r.won });
          }
        };
        raf.current = requestAnimationFrame(step);
      }
    );

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
          <BetControls bet={bet} setBet={setBet} lev={lev} setLev={setLev} balanceCents={balanceCents} disabled={pending || busy} lang={lang} />
          <Button className="w-full" size="lg" disabled={pending || busy || !parseFloat(bet)} onClick={play}>
            {busy ? t.launching : t.launch}
          </Button>
        </>
      }
    />
  );
}

// ---------- wheel ----------

function WheelCard({ balanceCents, lang }: { balanceCents: number; lang?: Lang }) {
  const t = getT(lang ?? "en");
  const { pending, run } = useGame();
  const [bet, setBet] = useState("10");
  const [lev, setLev] = useState("1");
  const [rot, setRot] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [net, setNet] = useState<Net>(null);

  const spin = () =>
    run(() => playWheel({ betCents: Math.round(parseFloat(bet || "0") * 100), leverage: Number(lev) })).then((r) => {
      if (r?.index == null) return;
      setNet(null);
      setSpinning(true);
      // Land segment `index` under the top pointer, plus ~6 full turns.
      const want = 360 - (r.index * WHEEL_STEP + WHEEL_STEP / 2);
      setRot((prev) => prev + 6 * 360 + (((want - (prev % 360)) % 360) + 360) % 360);
      setTimeout(() => {
        setSpinning(false);
        setNet({ stamp: Date.now(), netCents: r.netCents ?? 0, won: !!r.mult && r.mult > 0 });
      }, 3050);
    });

  const segs = WHEEL_SEGMENTS.map(
    (m, i) => `${m > 0 ? (i % 2 ? "var(--color-yes)" : "var(--color-brand-strong)") : "var(--color-surface-3)"} ${i * WHEEL_STEP}deg ${(i + 1) * WHEEL_STEP}deg`
  ).join(", ");

  return (
    <GameCard
      icon={<Disc3 className="size-4.5" />}
      title={t.gWheel}
      sub={t.gWheelSub}
      stage={
        <div className="relative flex flex-col items-center gap-3">
          <div
            className="absolute -top-1 z-10 size-0 border-x-[9px] border-t-[14px] border-x-transparent"
            style={{ borderTopColor: "var(--color-ink)" }}
          />
          <div
            className="relative size-[150px] rounded-full border-4 border-line shadow-[0_4px_16px_rgba(0,0,0,0.10)]"
            style={{
              background: `conic-gradient(${segs})`,
              transform: `rotate(${rot}deg)`,
              transition: "transform 3s cubic-bezier(0.15, 0.9, 0.25, 1)",
            }}
          >
            {WHEEL_SEGMENTS.map((m, i) => (
              <div
                key={i}
                className="absolute left-1/2 top-1/2 text-[10px] font-black"
                style={{
                  transform: `rotate(${i * WHEEL_STEP + WHEEL_STEP / 2 - 90}deg) translateY(-56px)`,
                  transformOrigin: "0 0",
                  color: m > 0 ? "var(--color-yes-on)" : "var(--color-faint)",
                }}
              >
                {m > 0 ? `${m}×` : "—"}
              </div>
            ))}
            <div className="absolute inset-0 m-auto size-9 rounded-full bg-surface border-2 border-line" />
          </div>
          <ResultTag net={spinning ? null : net} lang={lang} />
        </div>
      }
      controls={
        <>
          <BetControls bet={bet} setBet={setBet} lev={lev} setLev={setLev} balanceCents={balanceCents} disabled={pending || spinning} lang={lang} />
          <Button className="w-full" size="lg" disabled={pending || spinning || !parseFloat(bet)} onClick={spin}>
            {spinning ? t.spinning : t.spin}
          </Button>
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
} as const;

export type GameSlug = keyof typeof GAME_COMPONENTS;

export function GameView({ game, balanceCents, lang }: { game: GameSlug; balanceCents: number; lang?: Lang }) {
  const Game = GAME_COMPONENTS[game];
  return <Game balanceCents={balanceCents} lang={lang} />;
}
