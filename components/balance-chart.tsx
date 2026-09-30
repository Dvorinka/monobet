import { fmtMonos } from "@/lib/money";
import type { Lang } from "@/lib/i18n";

const W = 720;
const H = 160;
const PAD_T = 14;
const PAD_B = 10;

// Cash balance over time — every ledger row carries the post-entry balance,
// so the line steps between events and never invents values in between.
export function BalanceChart({
  points,
  lang,
}: {
  points: { t: Date; balanceCents: number }[];
  lang?: Lang;
}) {
  if (points.length < 2) return null;
  const t0 = points[0].t.getTime();
  const t1 = points[points.length - 1].t.getTime();
  const span = Math.max(1, t1 - t0);
  const vals = points.map((p) => p.balanceCents);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.12, 100);
  const yOf = (v: number) => PAD_T + (1 - (v - (lo - pad)) / (hi - lo + pad * 2)) * (H - PAD_T - PAD_B);
  const xOf = (t: number) => ((t - t0) / span) * (W - 8) + 4;

  // Step path — balance holds flat until the next ledger row moves it.
  let d = `M${xOf(t0).toFixed(1)},${yOf(vals[0]).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L${xOf(points[i].t.getTime()).toFixed(1)},${yOf(vals[i - 1]).toFixed(1)}`;
    d += ` L${xOf(points[i].t.getTime()).toFixed(1)},${yOf(vals[i]).toFixed(1)}`;
  }
  const area = `${d} L${xOf(t1).toFixed(1)},${H - PAD_B} L${xOf(t0).toFixed(1)},${H - PAD_B} Z`;
  const last = points[points.length - 1];
  const up = last.balanceCents >= vals[0];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" role="img" aria-label="balance history">
      <defs>
        <linearGradient id="balfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={up ? "var(--color-yes)" : "var(--color-no)"} stopOpacity="0.18" />
          <stop offset="1" stopColor={up ? "var(--color-yes)" : "var(--color-no)"} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#balfill)" />
      <path d={d} fill="none" stroke={up ? "var(--color-yes)" : "var(--color-no)"} strokeWidth="2" strokeLinejoin="round" />
      <circle cx={xOf(t1)} cy={yOf(last.balanceCents)} r={3.5} fill={up ? "var(--color-yes)" : "var(--color-no)"} />
      <text x={6} y={yOf(hi) - 4} fontSize={9} fontWeight={600} fill="var(--color-faint)" className="num">
        {fmtMonos(hi, { lang })}
      </text>
      <text x={6} y={yOf(lo) + 11} fontSize={9} fontWeight={600} fill="var(--color-faint)" className="num">
        {fmtMonos(lo, { lang })}
      </text>
    </svg>
  );
}
