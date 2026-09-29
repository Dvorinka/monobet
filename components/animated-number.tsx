"use client";

import { useEffect, useRef, useState } from "react";
import { fmtMarks, fmtMarksShort } from "@/lib/money";
import type { Lang } from "@/lib/i18n";

// Tweens a number toward its target with easeOutCubic. Used so live-refresh
// price updates glide instead of snapping.
export function useTweenedNumber(value: number, ms = 450): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const cur = from + (to - from) * e;
      setDisplay(cur);
      fromRef.current = cur;
      if (k < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, ms]);

  return display;
}

// "42%" that animates between values. Persists across server refreshes so
// polling updates animate rather than flicker.
export function AnimatedPct({ value, className }: { value: number; className?: string }) {
  const v = useTweenedNumber(value);
  return <span className={className}>{Math.round(v * 100)}%</span>;
}

// Marks balance that glides between values on refresh. `short` shows the
// compact form (Ɱ12.3k) and the full value on hover.
export function AnimatedMoney({ cents, className, lang, short }: { cents: number; className?: string; lang?: Lang; short?: boolean }) {
  const v = useTweenedNumber(cents);
  const rounded = Math.round(v);
  return (
    <span className={className} title={short ? fmtMarks(rounded, { lang }) : undefined}>
      {short ? fmtMarksShort(rounded) : fmtMarks(rounded, { lang })}
    </span>
  );
}
