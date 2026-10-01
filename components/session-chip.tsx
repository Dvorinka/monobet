"use client";

import { useEffect, useState } from "react";
import { Hourglass } from "lucide-react";
import { GAME_SESSION_MS, GAME_BREAK_MS } from "@/lib/games";
import { getT, type Lang } from "@/lib/i18n";

// Minigame pacing indicator: ticks down the 30 min play window, then shows the
// forced 30 min break. Renders nothing before the first stake or after the
// break lapses — the next stake opens a fresh window server-side.
export function SessionChip({ sessionStart, lang }: { sessionStart: number | null; lang?: Lang }) {
  const t = getT(lang ?? "en");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  if (sessionStart === null) return null;
  const left = sessionStart + GAME_SESSION_MS - now;
  const breakLeft = sessionStart + GAME_SESSION_MS + GAME_BREAK_MS - now;
  if (breakLeft <= 0) return null;

  const onBreak = left <= 0;
  const mins = Math.ceil((onBreak ? breakLeft : left) / 60000);
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold num " +
        (onBreak ? "border-warn/40 bg-warn-soft/50 text-warn-strong" : "border-line bg-surface-2 text-mute")
      }
    >
      <Hourglass className="size-3" />
      {onBreak ? t.sessionBreak(`${mins}m`) : t.sessionLeft(`${mins}m`)}
    </span>
  );
}
