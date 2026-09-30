"use client";

import { useMemo, useRef, useState } from "react";
import { getT, LOCALES, type Lang } from "@/lib/i18n";
import { fmtMonos } from "@/lib/money";
import { cn } from "@/lib/utils";

type Pt = { t: string; p: number };
export type Series = { key: string; label: string; color: string; points: Pt[] };

// A real trade pinned to the chart — dot sits at the post-trade price on the
// option's own series (key) and shows who traded what on hover.
export type ChartMarker = {
  t: string;
  p: number;
  key?: string;
  side: string;
  outcome: string;
  username: string | null;
  amountCents: number;
  image?: string | null;
};

const RANGES = [
  { key: "1M", ms: 60_000 },
  { key: "1H", ms: 3600_000 },
  { key: "1D", ms: 86400_000 },
  { key: "ALL", ms: Infinity },
] as const;

const RANGE_LABEL: Record<Lang, Record<(typeof RANGES)[number]["key"], string>> = {
  en: { "1M": "1m", "1H": "1h", "1D": "1d", ALL: "ALL" },
  cs: { "1M": "1m", "1H": "1h", "1D": "1d", ALL: "Vše" },
};

// True windowing: carry in the last price before the cutoff so lines start at
// window edge, then extend the last price flat out to `now`.
function windowPoints(points: Pt[], cutoff: number, now: number): Pt[] {
  let anchor: Pt | null = null;
  const inside: Pt[] = [];
  for (const p of points) {
    if (new Date(p.t).getTime() < cutoff) anchor = p;
    else inside.push(p);
  }
  const pts = anchor ? [{ t: new Date(cutoff).toISOString(), p: anchor.p }, ...inside] : inside;
  if (pts.length && now - new Date(pts[pts.length - 1].t).getTime() > 1000) {
    pts.push({ t: new Date(now).toISOString(), p: pts[pts.length - 1].p });
  }
  return pts;
}

const W = 720;
const H = 280;
const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 14;
const PAD_B = 26;

// Same midpoint-quadratic smoothing as the single-market chart.
function smoothPath(coords: readonly (readonly [number, number])[]): string {
  if (coords.length < 2) return "";
  if (coords.length === 2) return `M${coords[0][0]},${coords[0][1]} L${coords[1][0]},${coords[1][1]}`;
  let d = `M${coords[0][0].toFixed(1)},${coords[0][1].toFixed(1)}`;
  for (let i = 1; i < coords.length - 1; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[i + 1];
    d += ` Q${x1.toFixed(1)},${y1.toFixed(1)} ${((x1 + x2) / 2).toFixed(1)},${((y1 + y2) / 2).toFixed(1)}`;
  }
  const [lx, ly] = coords[coords.length - 1];
  d += ` L${lx.toFixed(1)},${ly.toFixed(1)}`;
  return d;
}

function fmtTick(t: number, span: number, locale: string): string {
  const d = new Date(t);
  if (span <= 300_000) return d.toLocaleTimeString(locale, { minute: "2-digit", second: "2-digit" });
  if (span <= 6 * 3600_000) return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (span <= 2 * 86400_000) return d.toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric" });
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

// Nearest point index to timestamp t (points sorted by time).
function nearestIndex(points: Pt[], t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (new Date(points[mid].t).getTime() <= t) lo = mid;
    else hi = mid;
  }
  const dLo = Math.abs(new Date(points[lo].t).getTime() - t);
  const dHi = Math.abs(new Date(points[hi].t).getTime() - t);
  return dLo <= dHi ? lo : hi;
}

// Polymarket-style multi-outcome chart: one colored line per option on a
// shared time axis, crosshair + legend of latest percentages.
export function MultiPriceChart({
  series,
  now,
  live,
  lang,
  focusKey,
  trades,
}: {
  series: Series[];
  now: number;
  live?: boolean;
  lang?: Lang;
  // The option selected in the list below — its line stays bold while the
  // rest fade to faint colored ghosts.
  focusKey?: string | null;
  trades?: ChartMarker[];
}) {
  const t = getT(lang ?? "en");
  const locale = LOCALES[lang ?? "en"];
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("ALL");
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [mark, setMark] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const r = RANGES.find((x) => x.key === range)!;

  const data = useMemo(() => {
    const cutoff = isFinite(r.ms) ? now - r.ms : -Infinity;
    return series
      .map((s) => ({ ...s, pts: windowPoints(s.points, cutoff, now) }))
      .filter((s) => s.pts.length > 0);
  }, [series, r, now]);

  // The x-axis IS the window — ranged views span exactly [now-ms, now]; ALL
  // anchors at the earliest point across series.
  const t1 = now;
  const t0 = useMemo(() => {
    if (isFinite(r.ms)) return t1 - r.ms;
    let lo = Infinity;
    for (const s of data) lo = Math.min(lo, new Date(s.pts[0].t).getTime());
    return isFinite(lo) ? lo : t1 - 1;
  }, [data, r, t1]);

  const { paths } = useMemo(() => {
    if (!data.length) return { paths: new Map<string, { line: string; last: Pt }>() };
    const span = Math.max(t1 - t0, 1);
    const x = (v: number) => PAD_L + ((v - t0) / span) * (W - PAD_L - PAD_R);
    const y = (p: number) => PAD_T + (1 - Math.min(1, Math.max(0, p))) * (H - PAD_T - PAD_B);
    const m = new Map<string, { line: string; last: Pt }>();
    for (const s of data) {
      const coords = s.pts.map((p) => [x(new Date(p.t).getTime()), y(p.p)] as const);
      m.set(s.key, { line: smoothPath(coords), last: s.pts[s.pts.length - 1] });
    }
    return { paths: m };
  }, [data, t0, t1]);

  const span = Math.max(t1 - t0, 1);
  const markers = useMemo(() => {
    const colorOf = new Map(data.map((s) => [s.key, { color: s.color, label: s.label }]));
    return (trades ?? [])
      .filter((m) => { const ms = new Date(m.t).getTime(); return ms >= t0 && ms <= t1 && m.key && colorOf.has(m.key); })
      .map((m) => ({ ...m, series: colorOf.get(m.key!)! }));
  }, [trades, t0, t1, data]);
  const markSize = (cents: number) => 2 + Math.min(2.4, Math.log10(Math.max(cents, 1) / 100 + 1) * 1.4);
  const x = (v: number) => PAD_L + ((v - t0) / span) * (W - PAD_L - PAD_R);
  const y = (p: number) => PAD_T + (1 - Math.min(1, Math.max(0, p))) * (H - PAD_T - PAD_B);

  const onMove = (e: React.PointerEvent) => {
    if (!svgRef.current || data.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    setHoverT(t0 + ((px - PAD_L) / (W - PAD_L - PAD_R)) * span);
  };

  // At hover time, each series' nearest point.
  const hoverPts = useMemo(() => {
    if (hoverT === null) return null;
    return data.map((s) => ({ s, p: s.pts[nearestIndex(s.pts, hoverT)] }));
  }, [hoverT, data]);

  const hoverX = hoverT !== null ? Math.min(W - PAD_R, Math.max(PAD_L, x(hoverT))) : 0;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {data.map((s) => {
            const focused = !focusKey || s.key === focusKey;
            return (
              <span
                key={s.key}
                className={cn("inline-flex items-center gap-1.5 text-[12px] font-semibold transition-opacity", !focused && "opacity-45")}
              >
                <span className="size-2 rounded-full" style={{ background: s.color }} />
                <span className="text-ink-2 max-w-36 truncate">{s.label}</span>
                <span className="num text-ink">{Math.round(s.pts[s.pts.length - 1].p * 100)}%</span>
              </span>
            );
          })}
          {live && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-mute">
              <span className="live-dot" />
              {t.live}
            </span>
          )}
        </div>
        <div className="flex gap-0.5 rounded-lg bg-surface-2 p-0.5 shrink-0">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={cn(
                "px-2.5 h-7 rounded-md text-[11.5px] font-semibold cursor-pointer transition-colors",
                range === r.key ? "bg-surface shadow-sm text-ink" : "text-mute hover:text-ink"
              )}
            >
              {RANGE_LABEL[lang ?? "en"][r.key]}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full select-none"
          onPointerMove={onMove}
          onPointerLeave={() => setHoverT(null)}
          onClick={() => setMark(null)}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((g) => (
            <g key={g}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y(g)} y2={y(g)} stroke="var(--color-line-2)" strokeDasharray={g === 0 ? "" : "3 4"} />
              <text x={PAD_L - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="var(--color-faint)" className="num">
                {Math.round(g * 100)}%
              </text>
            </g>
          ))}

          <g key={range}>
            {data.map((s) => {
              const p = paths.get(s.key);
              if (!p) return null;
              const focused = !focusKey || s.key === focusKey;
              if (s.pts.length === 1)
                return (
                  <circle
                    key={s.key}
                    cx={x(new Date(s.pts[0].t).getTime())}
                    cy={y(s.pts[0].p)}
                    r={focused ? 4 : 2.5}
                    fill={s.color}
                    opacity={focused ? 1 : 0.18}
                  />
                );
              return (
                <path
                  key={s.key}
                  d={p.line}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={focused ? 2.5 : 1.2}
                  opacity={focused ? 1 : 0.16}
                  strokeDasharray={focused ? undefined : "1 3"}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  pathLength={1}
                  className="anim-draw"
                />
              );
            })}
            {live &&
              data.map((s) => {
                const focused = !focusKey || s.key === focusKey;
                const last = s.pts[s.pts.length - 1];
                return (
                  <circle
                    key={s.key}
                    cx={x(new Date(last.t).getTime())}
                    cy={y(last.p)}
                    r={focused ? 3 : 2}
                    fill={s.color}
                    stroke="var(--color-surface)"
                    strokeWidth="1.5"
                    opacity={focused ? 1 : 0.25}
                  />
                );
              })}
          </g>

          {markers.map((m, i) => {
            const mx = x(new Date(m.t).getTime());
            const my = y(m.p);
            const outCol = m.outcome === "yes" ? "var(--color-yes)" : "var(--color-no)";
            const focused = !focusKey || m.key === focusKey;
            return (
              <g key={i} opacity={focused ? 1 : 0.25}>
                <circle
                  cx={mx} cy={my} r={markSize(m.amountCents)}
                  fill="var(--color-surface)"
                  stroke={outCol} strokeWidth="1.6"
                  strokeDasharray={m.side === "buy" ? undefined : "2 2"}
                  opacity={mark === null || mark === i ? 0.95 : 0.45}
                  className={mark === i ? "drop-shadow" : undefined}
                />
                <circle
                  cx={mx} cy={my} r={9} fill="transparent" className="cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); setMark(mark === i ? null : i); }}
                />
              </g>
            );
          })}

          {hoverPts && (
            <g>
              <line pointerEvents="none" x1={hoverX} x2={hoverX} y1={PAD_T} y2={H - PAD_B} stroke="var(--color-faint)" strokeDasharray="3 3" />
              {hoverPts.map(({ s, p }) => (
                <circle pointerEvents="none" key={s.key} cx={x(new Date(p.t).getTime())} cy={y(p.p)} r="4" fill={s.color} stroke="var(--color-surface)" strokeWidth="2" />
              ))}
            </g>
          )}
        </svg>

        {mark !== null && markers[mark] && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-ink shadow-lg"
            style={{
              left: `${Math.min(88, Math.max(12, (x(new Date(markers[mark].t).getTime()) / W) * 100))}%`,
              top: "0", transform: "translateX(-50%)",
            }}
          >
            <div className="flex items-center gap-1.5 text-[11.5px] whitespace-nowrap">
              <span className="font-semibold">@{markers[mark].username ?? "?"}</span>
              <span className="text-mute">{markers[mark].side === "buy" ? t.bought : t.sold}</span>
              <span className={cn("font-bold", markers[mark].outcome === "yes" ? "text-yes-strong" : "text-no-strong")}>
                {(markers[mark].outcome === "yes" ? t.yes : t.no).toUpperCase()}
              </span>
              <span className="text-[10.5px] font-medium text-mute max-w-28 truncate">{markers[mark].series.label}</span>
              <span className="num font-bold">{fmtMonos(markers[mark].amountCents, { lang })}</span>
            </div>
            <div className="num mt-0.5 text-[10px] font-medium text-mute whitespace-nowrap">
              {new Date(markers[mark].t).toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              {" · "}{Math.round(markers[mark].p * 100)}%
            </div>
          </div>
        )}

        {mark === null && hoverPts && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-ink shadow-lg"
            style={{ left: `${(hoverX / W) * 100}%`, top: "0", transform: "translateX(-50%)" }}
          >
            <div className="space-y-0.5">
              {hoverPts.map(({ s, p }) => (
                <div key={s.key} className="flex items-center gap-1.5 text-[11.5px] whitespace-nowrap">
                  <span className="size-1.5 rounded-full" style={{ background: s.color }} />
                  <span className="text-mute max-w-32 truncate">{s.label}</span>
                  <span className="num font-bold ml-auto pl-2">{Math.round(p.p * 100)}%</span>
                </div>
              ))}
            </div>
            <div className="num mt-1 pt-1 border-t border-line-2 text-[10px] font-medium text-mute whitespace-nowrap">
              {new Date(hoverPts[0].p.t).toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between text-[11px] text-faint num -mt-1 pl-11 pr-3">
        {t1 > 0 &&
          [0, 0.25, 0.5, 0.75, 1].map((k) => {
            const v = t0 + (t1 - t0) * k;
            return <span key={k}>{fmtTick(v, span, locale)}</span>;
          })}
      </div>
    </div>
  );
}
