"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Custom date+time picker — same value contract as <input type="datetime-local">:
// "YYYY-MM-DDTHH:mm" in local wall time ("" when unset). Callers keep doing
// new Date(value).toISOString() to submit a real instant.

function parse(v: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function DateTimePicker({
  value,
  onChange,
  lang = "en",
  placeholder,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  lang?: Lang;
  placeholder?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const sel = parse(value);
  const now = new Date();
  // Visible month — starts on the selected month, or the current one.
  const [view, setView] = useState(() => ({
    y: sel?.y ?? now.getFullYear(),
    mo: sel?.mo ?? now.getMonth() + 1,
  }));
  const [hourText, setHourText] = useState<string | null>(null); // null = follow value

  const locale = lang === "cs" ? "cs-CZ" : "en-US";
  const monthName = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }),
    [locale]
  );
  const weekdayFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "narrow" }),
    [locale]
  );
  const displayFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale]
  );

  // First weekday: cs weeks start Monday, en Sunday.
  const firstDow = lang === "cs" ? 1 : 0;
  const weekdays = useMemo(() => {
    // Oct 1 2023 was a Sunday — offset from there.
    return Array.from({ length: 7 }, (_, i) =>
      weekdayFmt.format(new Date(2023, 9, 1 + ((firstDow + i) % 7)))
    );
  }, [weekdayFmt, firstDow]);

  // Day cells for the visible month — leading blanks to the first weekday.
  const cells = useMemo(() => {
    const dim = new Date(view.y, view.mo, 0).getDate();
    const lead = (new Date(view.y, view.mo - 1, 1).getDay() - firstDow + 7) % 7;
    return [...Array<null>(lead).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];
  }, [view, firstDow]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const commit = (p: { y: number; mo: number; d: number; h: number; mi: number }) =>
    onChange(`${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`);

  const pickDay = (d: number) =>
    commit({ y: view.y, mo: view.mo, d, h: sel?.h ?? 12, mi: sel?.mi ?? 0 });
  const pickHour = (h: number) => {
    const p = sel ?? { y: view.y, mo: view.mo, d: now.getDate(), h: 12, mi: 0 };
    commit({ ...p, h });
  };
  const pickMinute = (mi: number) => {
    const p = sel ?? { y: view.y, mo: view.mo, d: now.getDate(), h: 12, mi: 0 };
    commit({ ...p, mi });
  };
  const shiftMonth = (dir: 1 | -1) => {
    setView((v) => {
      const d = new Date(v.y, v.mo - 1 + dir, 1);
      return { y: d.getFullYear(), mo: d.getMonth() + 1 };
    });
  };

  const isToday = (d: number) =>
    d === now.getDate() && view.mo === now.getMonth() + 1 && view.y === now.getFullYear();
  const isSel = (d: number) => sel && d === sel.d && view.mo === sel.mo && view.y === sel.y;

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-10 w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm",
          "focus:outline-2 focus:outline-brand focus:outline-offset-0 focus:border-brand cursor-pointer",
          sel ? "text-ink" : "text-faint"
        )}
      >
        <CalendarDays className="size-4 shrink-0 text-faint" />
        <span className="truncate">
          {sel
            ? displayFmt.format(new Date(sel.y, sel.mo - 1, sel.d, sel.h, sel.mi))
            : (placeholder ?? "—")}
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 w-64 rounded-xl border border-line bg-surface p-3 shadow-lg">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="grid size-7 place-items-center rounded-md text-mute hover:bg-surface-2 hover:text-ink cursor-pointer"
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </button>
            <div className="text-[13px] font-semibold capitalize">
              {monthName.format(new Date(view.y, view.mo - 1, 1))}
            </div>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="grid size-7 place-items-center rounded-md text-mute hover:bg-surface-2 hover:text-ink cursor-pointer"
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <div className="mt-2 grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold uppercase text-faint">
            {weekdays.map((w, i) => (
              <div key={i} className="py-0.5">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) =>
              d === null ? (
                <div key={`b${i}`} />
              ) : (
                <button
                  key={d}
                  type="button"
                  onClick={() => pickDay(d)}
                  className={cn(
                    "h-7 rounded-md text-[12.5px] cursor-pointer transition-colors",
                    isSel(d)
                      ? "bg-brand font-semibold text-brand-on"
                      : isToday(d)
                        ? "font-semibold text-brand hover:bg-surface-2"
                        : "text-ink hover:bg-surface-2"
                  )}
                >
                  {d}
                </button>
              )
            )}
          </div>

          <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2.5">
            <input
              type="number"
              min={0}
              max={23}
              value={hourText ?? pad(sel?.h ?? 12)}
              onChange={(e) => {
                setHourText(e.target.value);
                const h = Number(e.target.value);
                if (Number.isInteger(h) && h >= 0 && h <= 23) pickHour(h);
              }}
              onBlur={() => setHourText(null)}
              className="h-8 w-14 rounded-md border border-line bg-surface text-center text-[13px] text-ink focus:outline-2 focus:outline-brand"
              aria-label="Hour"
            />
            <span className="font-semibold text-mute">:</span>
            <select
              value={sel?.mi ?? 0}
              onChange={(e) => pickMinute(Number(e.target.value))}
              className="h-8 rounded-md border border-line bg-surface px-1.5 text-[13px] text-ink cursor-pointer focus:outline-2 focus:outline-brand"
              aria-label="Minute"
            >
              {Array.from({ length: 12 }, (_, i) => i * 5).map((mi) => (
                <option key={mi} value={mi}>{pad(mi)}</option>
              ))}
              {sel && sel.mi % 5 !== 0 && <option value={sel.mi}>{pad(sel.mi)}</option>}
            </select>
            <div className="ml-auto flex gap-1">
              <button
                type="button"
                onClick={() =>
                  commit({
                    y: now.getFullYear(),
                    mo: now.getMonth() + 1,
                    d: now.getDate(),
                    h: now.getHours(),
                    mi: now.getMinutes(),
                  })
                }
                className="h-7 rounded-md px-2 text-[12px] font-medium text-mute hover:bg-surface-2 hover:text-ink cursor-pointer"
              >
                {lang === "cs" ? "Teď" : "Now"}
              </button>
              {sel && (
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="h-7 rounded-md px-2 text-[12px] font-medium text-mute hover:bg-surface-2 hover:text-ink cursor-pointer"
                >
                  {lang === "cs" ? "Vymazat" : "Clear"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
