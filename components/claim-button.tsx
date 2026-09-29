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
      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold cursor-pointer
        bg-ink text-white hover:bg-ink-2 disabled:opacity-50 disabled:cursor-not-allowed"
      title="Claim your daily Marks"
    >
      <Coins className="size-4" />
      <span className="hidden sm:inline">{pending ? "Claiming…" : "Claim"}</span>
    </button>
  );
}
