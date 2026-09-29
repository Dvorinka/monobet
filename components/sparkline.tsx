export function Sparkline({ points, className }: { points: number[]; className?: string }) {
  const w = 72;
  const h = 28;
  if (points.length < 2) {
    return <div className={className} style={{ width: w, height: h }} />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 0.05;
  const pts = points
    .map((p, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${(h - 3 - ((p - min) / span) * (h - 6)).toFixed(1)}`)
    .join(" ");
  const up = points[points.length - 1] >= points[0];
  return (
    <svg width={w} height={h} className={className} aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke={up ? "var(--color-yes)" : "var(--color-no)"}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        pathLength={1}
        className="anim-draw"
      />
    </svg>
  );
}
