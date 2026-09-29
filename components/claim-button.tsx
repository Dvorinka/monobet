"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { claimDaily } from "@/lib/actions";
import { Coins } from "lucide-react";

export function ClaimButton() {
  const [pending, start] = useTransition();
  const [cooling, setCooling] = useState(false);
  const router = useRouter();

  return (
    <button
      disabled={pending || cooling}
      onClick={() =>
        start(async () => {
          const r = await claimDaily();
          if (r.ok) {
            toast.success("Claimed Ɱ250");
            router.refresh();
          } else {
            toast.error(r.error ?? "Claim unavailable");
            if (r.error?.includes("available in")) setCooling(true);
          }
        })
      }
      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold cursor-pointer transition-all duration-150
        bg-brand-soft text-brand-strong hover:bg-brand active:scale-[0.97] hover:text-brand-on disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
      title="Claim your daily Marks"
    >
      <Coins className="size-4" />
      <span className="hidden sm:inline">{pending ? "Claiming…" : "Claim"}</span>
    </button>
  );
}
