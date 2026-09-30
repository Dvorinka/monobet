"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Flame, Landmark } from "lucide-react";
import { Button, Segmented } from "@/components/ui/primitives";
import { wallPray, setVow as vowAction } from "@/lib/actions";
import {
  WALL_COOLDOWN_MS,
  WALL_FEE_MIN_CENTS,
  WALL_FEE_DEBT_PCT,
  WALL_CLEAR_MIN_PCT,
  WALL_CLEAR_MAX_PCT,
  VOW_CHOICES_BPS,
} from "@/lib/games";
import { fmtMonos, timeAgo } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type WallPrayerRow = {
  id: string;
  note: string;
  feeCents: number;
  clearedCents: number;
  createdAt: Date;
  username: string | null;
  name: string;
};

export function WallCard({
  debtCents,
  wallPrayerAt,
  vowBps,
  prayers,
  lang,
  now,
}: {
  debtCents: number;
  wallPrayerAt: Date | null;
  vowBps: number;
  prayers: WallPrayerRow[];
  lang?: Lang;
  now: number;
}) {
  const t = getT(lang ?? "en");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [vow, setVow] = useState(String(vowBps));
  const [last, setLast] = useState<{ cleared: number; silent: boolean } | null>(null);

  const inDebt = debtCents > 0;
  const fee = Math.max(WALL_FEE_MIN_CENTS, Math.round(debtCents * WALL_FEE_DEBT_PCT));
  const nextAt = wallPrayerAt ? wallPrayerAt.getTime() + WALL_COOLDOWN_MS : null;
  const cooling = !!nextAt && nextAt > now;

  const pray = () =>
    start(async () => {
      const r = await wallPray({ note });
      if (!r.ok) { toast.error(r.error); return; }
      playWallSfx();
      setLast({ cleared: r.clearedCents ?? 0, silent: !!r.silent });
      setNote("");
      router.refresh();
    });

  const changeVow = (v: string) => {
    setVow(v);
    start(async () => {
      const r = await vowAction({ bps: Number(v) });
      if (!r.ok) toast.error(r.error);
      else toast.success(Number(v) === 0 ? t.wallVowOff : t.wallVowSet(Number(v) / 100));
    });
  };

  // The paper slips peeking out of the wall — latest public notes.
  const slips = prayers.filter((p) => p.note).slice(0, 6);

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      {/* the wall itself — stone bricks with prayer slips in the cracks */}
      <div className="wall-bricks relative h-28 px-4 pt-3 overflow-hidden">
        <div className="relative z-10 flex items-center gap-2">
          <Landmark className="size-4 text-white/80" />
          <span className="text-[13px] font-bold text-white tracking-wide drop-shadow">{t.wallTitle}</span>
        </div>
        <div className="absolute inset-x-3 bottom-1.5 flex items-end gap-3">
          {slips.map((p, i) => (
            <div
              key={p.id}
              className="wall-slip bg-[#f5f0e4] text-[#4a4033] text-[9px] leading-tight px-1.5 py-1 rounded-[2px] shadow-sm max-w-30 truncate"
              style={{ transform: `rotate(${(i % 2 === 0 ? -1 : 1) * (2 + (i % 3))}deg)` }}
              title={`@${p.username ?? p.name}: ${p.note}`}
            >
              {p.note}
            </div>
          ))}
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <p className="text-[12.5px] text-mute leading-relaxed max-w-md">
            {inDebt ? t.wallSub : t.wallNoDebt}
          </p>
          {inDebt && (
            <div className="text-right">
              <div className="num text-sm font-bold text-no-strong">{t.loanOwed(fmtMonos(debtCents, { lang }))}</div>
            </div>
          )}
        </div>

        {inDebt && (
          <>
            <div className="mt-3 flex gap-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={140}
                placeholder={t.wallNotePh}
                className="h-9 flex-1 rounded-lg border border-line bg-surface px-3 text-[13px] text-ink placeholder:text-faint focus:outline-2 focus:outline-brand"
              />
              <Button onClick={pray} disabled={pending || cooling} className="gap-1.5">
                <Flame className="size-4" />
                {cooling
                  ? t.wallCooldown
                  : `${t.wallPray} · ${fmtMonos(fee, { lang })}`}
              </Button>
            </div>
            <p className="mt-1.5 text-[11.5px] text-faint">
              {t.wallRules(fmtMonos(WALL_FEE_MIN_CENTS, { lang }), Math.round(WALL_CLEAR_MIN_PCT * 100), Math.round(WALL_CLEAR_MAX_PCT * 100))}
            </p>

            {last && (
              <div className={cn("mt-3 rounded-lg border px-3 py-2 text-[12.5px] font-semibold anim-rise",
                last.silent || last.cleared === 0
                  ? "border-line bg-surface-2 text-mute"
                  : "border-yes/30 bg-yes-soft text-yes-strong")}>
                {last.silent
                  ? t.wallSilent
                  : t.wallCleared(fmtMonos(last.cleared, { lang }))}
              </div>
            )}

            {/* the vow — a lasting sacrifice, not a one-off candle */}
            <div className="mt-4">
              <div className="text-[12px] font-semibold text-mute mb-1.5">{t.wallVow}</div>
              <Segmented
                options={VOW_CHOICES_BPS.map((b) => ({ value: String(b), label: b === 0 ? t.wallVowNone : `${b / 100}%` }))}
                value={vow}
                onChange={changeVow}
              />
            </div>
          </>
        )}

        {prayers.length > 0 && (
          <div className="mt-4 pt-3 border-t border-line-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-faint mb-2">{t.wallPrayers}</div>
            <div className="divide-y divide-line-2">
              {prayers.map((p) => (
                <div key={p.id} className="py-1.5 flex items-center gap-2 text-[12.5px]">
                  <span className="font-medium w-24 truncate">@{p.username ?? p.name}</span>
                  <span className="text-mute truncate flex-1">{p.note || "…"}</span>
                  <span className="num text-faint">−{fmtMonos(p.feeCents, { lang })}</span>
                  {p.clearedCents > 0 ? (
                    <span className="num font-bold text-yes-strong">+{fmtMonos(p.clearedCents, { lang })} {t.wallForgiven}</span>
                  ) : (
                    <span className="text-[11px] font-medium text-faint">{t.wallSilentShort}</span>
                  )}
                  <span className="text-[11px] text-faint w-14 text-right">{timeAgo(p.createdAt, lang)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function playWallSfx() {
  // candle flicker — reuse the soft claim cue
  import("@/lib/sfx").then((m) => m.playSfx("claim", 0.35));
}
