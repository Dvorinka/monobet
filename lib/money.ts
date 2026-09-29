// Currency: Marks (Ɱ). Balances stored as integer cents; share prices shown in ¢ like Polymarket.

import { getT, LOCALES, type Lang } from "@/lib/i18n";

export function fmtMarks(cents: number, opts?: { decimals?: boolean; lang?: Lang }): string {
  const marks = cents / 100;
  const sign = marks < 0 ? "-" : "";
  const abs = Math.abs(marks);
  const showDecimals = opts?.decimals ?? !Number.isInteger(abs);
  return (
    sign +
    "Ɱ" +
    abs.toLocaleString(LOCALES[opts?.lang ?? "en"], {
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

export function fmtShares(n: number, lang?: Lang): string {
  return n.toLocaleString(LOCALES[lang ?? "en"], { maximumFractionDigits: 2 });
}

export function timeAgo(d: Date | string, lang?: Lang): string {
  const t = getT(lang ?? "en");
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return t.agoS(s);
  if (s < 3600) return t.agoM(Math.floor(s / 60));
  if (s < 86400) return t.agoH(Math.floor(s / 3600));
  return t.agoD(Math.floor(s / 86400));
}

export function fmtCountdown(until: Date | string): string {
  const ms = Math.max(0, new Date(until).getTime() - Date.now());
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

export function fmtDate(d: Date | string | null | undefined, lang?: Lang): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(LOCALES[lang ?? "en"], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
