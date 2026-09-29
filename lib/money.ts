// Currency: Marks (Ɱ). Balances stored as integer cents; share prices shown in ¢ like Polymarket.

export function fmtMarks(cents: number, opts?: { decimals?: boolean }): string {
  const marks = cents / 100;
  const sign = marks < 0 ? "-" : "";
  const abs = Math.abs(marks);
  const showDecimals = opts?.decimals ?? !Number.isInteger(abs);
  return (
    sign +
    "Ɱ" +
    abs.toLocaleString("en-US", {
      minimumFractionDigits: showDecimals ? 2 : 0,
      maximumFractionDigits: showDecimals ? 2 : 0,
    })
  );
}

// 0.632 -> "63¢"
export function fmtCents(p: number): string {
  return `${Math.round(p * 100)}¢`;
}

// 0.632 -> "63%"
export function fmtPct(p: number): string {
  return `${(p * 100).toFixed(p < 0.1 && p > 0 ? 1 : 0)}%`;
}

export function fmtShares(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function timeAgo(d: Date | string): string {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
