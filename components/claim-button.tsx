"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { claimDaily } from "@/lib/actions";
import { Coins } from "lucide-react";
import { getT, type Lang } from "@/lib/i18n";

export function ClaimButton({ lang }: { lang?: Lang }) {
  const [pending, start] = useTransition();
  const [cooling, setCooling] = useState(false);
  const router = useRouter();
  const t = getT(lang ?? "en");

  return (
    <button
      disabled={pending || cooling}
      onClick={() =>
        start(async () => {
          const r = await claimDaily();
          if (r.ok) {
            toast.success(t.claimedToast);
            router.refresh();
          } else {
            toast.error(r.error ?? "Claim unavailable");
            if (r.error?.includes("available in")) setCooling(true);
          }
        })
      }
      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold cursor-pointer transition-all duration-150
        bg-brand-soft text-brand-strong hover:bg-brand active:scale-[0.97] hover:text-brand-on disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
      title={t.claimTitle}
    >
      <Coins className="size-4" />
      <span className="hidden sm:inline">{pending ? t.claiming : t.claim}</span>
    </button>
  );
}
