"use client";

import { useMemo, useRef, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedPct } from "@/components/animated-number";

type Pt = { t: string; p: number };
const RANGES = [
  { key: "1H", ms: 3600_000 },
  { key: "6H", ms: 6 * 3600_000 },
  { key: "1D", ms: 86400_000 },
  { key: "1W", ms: 7 * 86400_000 },
  { key: "ALL", ms: Infinity },
] as const;

const W = 720;
const H = 300;
const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 26;

// Catmull-Rom-flavored smoothing: quadratic curves through segment midpoints.
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

function fmtTick(t: number, span: number): string {
  const d = new Date(t);
  if (span <= 6 * 3600_000) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (span <= 2 * 86400_000)
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function PriceChart({ points, now, live }: { points: Pt[]; now: number; live?: boolean }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("ALL");
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const data = useMemo(() => {
    const r = RANGES.find((x) => x.key === range)!;
    const cutoff = now - r.ms;
    const filtered = points.filter((p) => new Date(p.t).getTime() >= cutoff);
    const base = filtered.length >= 2 ? filtered : points;
    // Extend the last price flat out to "now" so the line reaches the edge,
    // like Polymarket's resting line between trades.
    if (base.length > 0 && now - new Date(base[base.length - 1].t).getTime() > 1000) {
      return [...base, { t: new Date(now).toISOString(), p: base[base.length - 1].p }];
    }
    return base;
  }, [points, range, now]);

  const { linePath, areaPath, last } = useMemo(() => {
    if (data.length === 0) return { linePath: "", areaPath: "", last: null as Pt | null };
    const t0 = new Date(data[0].t).getTime();
    const t1 = new Date(data[data.length - 1].t).getTime();
    const span = Math.max(t1 - t0, 1);
    const x = (t: number) => PAD_L + ((t - t0) / span) * (W - PAD_L - PAD_R);
    const y = (p: number) => PAD_T + (1 - Math.min(1, Math.max(0, p))) * (H - PAD_T - PAD_B);
    const coords = data.map((d) => [x(new Date(d.t).getTime()), y(d.p)] as const);
    const line = smoothPath(coords);
    const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${y(0)} L${coords[0][0].toFixed(1)},${y(0)} Z`;
    return { linePath: line, areaPath: area, last: data[data.length - 1] };
  }, [data]);

  const t0 = data.length ? new Date(data[0].t).getTime() : 0;
  const t1 = data.length ? new Date(data[data.length - 1].t).getTime() : 0;
  const x = (t: number) => PAD_L + ((t - t0) / Math.max(t1 - t0, 1)) * (W - PAD_L - PAD_R);
  const y = (p: number) => PAD_T + (1 - Math.min(1, Math.max(0, p))) * (H - PAD_T - PAD_B);

  const onMove = (e: React.PointerEvent) => {
    if (!svgRef.current || data.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    data.forEach((d, i) => {
      const dx = Math.abs(x(new Date(d.t).getTime()) - px);
      if (dx < bestD) {
        bestD = dx;
        best = i;
      }
    });
    setHover(best);
  };

  const hoverPt = hover !== null ? data[hover] : null;
  const delta = data.length > 1 ? data[data.length - 1].p - data[0].p : 0;
  const up = data.length <= 1 || delta >= 0;
  const stroke = data.length <= 1 ? "var(--color-mute)" : up ? "var(--color-yes)" : "var(--color-no)";
  const hoverX = hoverPt ? x(new Date(hoverPt.t).getTime()) : 0;
  const hoverY = hoverPt ? y(hoverPt.p) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="num flex items-center gap-2.5">
          <AnimatedPct
            value={last?.p ?? 0}
            className="text-[34px] font-bold tracking-tight leading-none"
          />
          <span className="text-[13px] font-medium text-mute">chance</span>
          {data.length > 1 && Math.abs(delta) > 0.004 && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold num",
                up ? "bg-yes-soft text-yes-strong" : "bg-no-soft text-no-strong"
              )}
            >
              {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
              {delta > 0 ? "+" : ""}
              {Math.round(delta * 100)}%
            </span>
          )}
          {live && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-mute">
              <span className="live-dot" />
              Live
            </span>
          )}
        </div>
        <div className="flex gap-0.5 rounded-lg bg-surface-2 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={cn(
                "px-2.5 h-7 rounded-md text-[11.5px] font-semibold cursor-pointer transition-colors",
                range === r.key ? "bg-surface shadow-sm text-ink" : "text-mute hover:text-ink"
              )}
            >
              {r.key}
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
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map((g) => (
            <g key={g}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y(g)} y2={y(g)} stroke="var(--color-line-2)" strokeDasharray={g === 0 ? "" : "3 4"} />
              <text x={PAD_L - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="var(--color-faint)" className="num">
                {Math.round(g * 100)}%
              </text>
            </g>
          ))}

          {data.length > 1 && (
            <g key={`${range}-${data.length}`}>
              <path d={areaPath} fill="url(#chartFill)" className="anim-fade" />
              <path
                d={linePath}
                fill="none"
                stroke={stroke}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                pathLength={1}
                className="anim-draw"
              />
              {live && (
                <g>
                  <circle cx={x(t1)} cy={y(last!.p)} r="3.5" fill={stroke} />
                  <circle cx={x(t1)} cy={y(last!.p)} r="3.5" fill={stroke} className="anim-ping" />
                </g>
              )}
            </g>
          )}
          {data.length === 1 && <circle cx={x(t0)} cy={y(data[0].p)} r="4" fill={stroke} />}

          {hoverPt && (
            <g>
              <line x1={hoverX} x2={hoverX} y1={PAD_T} y2={H - PAD_B} stroke="var(--color-faint)" strokeDasharray="3 3" />
              <circle cx={hoverX} cy={hoverY} r="4.5" fill={stroke} stroke="#fff" strokeWidth="2" />
            </g>
          )}
        </svg>

        {hoverPt && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-ink px-2.5 py-1.5 text-white shadow-lg"
            style={{ left: `${(hoverX / W) * 100}%`, top: `${(hoverY / H) * 100 - 3}%` }}
          >
            <div className="num text-[12.5px] font-bold leading-none">
              {Math.round(hoverPt.p * 100)}%
            </div>
            <div className="num mt-0.5 text-[10px] font-medium text-white/70 whitespace-nowrap">
              {new Date(hoverPt.t).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between text-[11px] text-faint num -mt-1 pl-11 pr-3">
        {data.length > 0 &&
          [0, 0.25, 0.5, 0.75, 1].map((k) => {
            const t = t0 + (t1 - t0) * k;
            return <span key={k}>{fmtTick(t, t1 - t0)}</span>;
          })}
      </div>
    </div>
  );
}
