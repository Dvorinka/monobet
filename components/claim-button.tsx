"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { claimDaily } from "@/lib/actions";
import { DAILY_COOLDOWN_MS } from "@/lib/rewards";
import { Coins, Timer } from "lucide-react";
import { getT, type Lang } from "@/lib/i18n";

// Compact: whole hours ("19h"), or minutes under an hour ("42m").
function fmtCountdown(ms: number) {
  const mins = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h + (m > 0 ? 1 : 0)}h` : `${m}m`;
}

export function ClaimButton({ lang, nextAt }: { lang?: Lang; nextAt: number | null }) {
  const [pending, start] = useTransition();
  const [next, setNext] = useState(nextAt);
  const [now, setNow] = useState(() => Date.now());
  const router = useRouter();
  const t = getT(lang ?? "en");

  // Server re-render after a claim pushes a fresh lastClaimAt down as nextAt —
  // sync it into local state during render instead of an effect.
  const [prevNextAt, setPrevNextAt] = useState(nextAt);
  if (prevNextAt !== nextAt) {
    setPrevNextAt(nextAt);
    setNext(nextAt);
  }

  useEffect(() => {
    if (!next) return;
    const id = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= next) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [next]);

  const cooling = !!next && next > now;
  const remaining = cooling ? next - now : 0;

  return (
    <button
      disabled={pending}
      onClick={() => {
        if (cooling) return router.push("/rewards");
        start(async () => {
          const r = await claimDaily();
          if (r.ok) {
            toast.success(t.claimedToast);
            setNext(Date.now() + DAILY_COOLDOWN_MS);
            router.refresh();
          } else {
            toast.error(r.error === "cooldown" ? t.availableIn(r.retryInH ?? 1) : r.error ?? "Claim unavailable");
            if (r.retryInMs) setNext(Date.now() + r.retryInMs);
          }
        });
      }}
      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold cursor-pointer transition-all duration-150
        bg-brand-soft text-brand-strong hover:bg-brand active:scale-[0.97] hover:text-brand-on disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
      title={cooling ? t.availableIn(Math.max(1, Math.ceil(remaining / 3600000))) : t.claimTitle}
    >
      {cooling ? <Timer className="size-4" /> : <Coins className="size-4" />}
      <span className="hidden sm:inline num">
        {pending ? t.claiming : cooling ? fmtCountdown(next - now) : t.claim}
      </span>
    </button>
  );
}
