"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatedMoney } from "@/components/animated-number";
import { fmtMonosShort } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";

// Live budget chips — the header is server-rendered once per navigation, so
// this polls /api/me to keep balance and debt current (loans, game wins,
// stop-loss fills, admin grants all land here without a page change).
const POLL_MS = 8000;

export function WalletChip({
  balanceCents: ssrBalance,
  debtCents: ssrDebt,
  lang,
}: {
  balanceCents: number;
  debtCents: number;
  lang?: Lang;
}) {
  const t = getT(lang ?? "en");
  const [balance, setBalance] = useState(ssrBalance);
  const [debt, setDebt] = useState(ssrDebt);
  const ssrRef = useRef({ balanceCents: ssrBalance, debtCents: ssrDebt });

  // Server re-render (navigation/revalidation) reseeds the chips.
  useEffect(() => {
    const prev = ssrRef.current;
    if (prev.balanceCents !== ssrBalance || prev.debtCents !== ssrDebt) {
      ssrRef.current = { balanceCents: ssrBalance, debtCents: ssrDebt };
      setBalance(ssrBalance);
      setDebt(ssrDebt);
    }
  }, [ssrBalance, ssrDebt]);

  const tick = useCallback(async () => {
    try {
      const r = await fetch("/api/me", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      if (typeof d.balanceCents === "number") setBalance(d.balanceCents);
      if (typeof d.debtCents === "number") setDebt(d.debtCents);
    } catch {
      // transient network/db blip — keep last values
    }
  }, []);

  useEffect(() => {
    const id = setInterval(tick, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", tick);
    };
  }, [tick]);

  return (
    <>
      <Link
        href="/rewards"
        className="num inline-flex items-center h-8 sm:h-9 px-2 sm:px-3 rounded-lg bg-surface-2 text-[13px] sm:text-sm font-semibold hover:bg-surface-3"
        title={t.yourBalance}
      >
        <AnimatedMoney cents={balance} lang={lang} short />
      </Link>
      {debt > 0 && (
        <Link
          href="/rewards"
          className="num inline-flex items-center h-8 sm:h-9 px-2 sm:px-2.5 rounded-lg bg-no-soft text-no-strong text-[12px] sm:text-[13px] font-bold border border-no/30"
          title={`${t.owedChip} — repay on Rewards`}
        >
          −{fmtMonosShort(Math.round(debt / 100) * 100)}
        </Link>
      )}
    </>
  );
}
