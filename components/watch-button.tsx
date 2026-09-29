"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bookmark } from "lucide-react";
import { toast } from "sonner";
import { toggleWatchlist } from "@/lib/actions";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Bookmark toggle rendered inside market cards and on the market page — adds
// the market to the Watching tab. Lives in a <Link> card in some contexts, so
// it swallows the event itself.
export function WatchButton({
  marketId,
  watching: initial,
  lang,
  className,
}: {
  marketId: string;
  watching: boolean;
  lang?: Lang;
  className?: string;
}) {
  const t = getT(lang ?? "en");
  const [watching, setWatching] = useState(initial);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={pending}
      title={watching ? t.watchRemove : t.watchAdd}
      aria-label={watching ? t.watchRemove : t.watchAdd}
      aria-pressed={watching}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        start(async () => {
          const r = await toggleWatchlist({ marketId });
          if (r.ok) {
            setWatching(r.watching ?? false);
            router.refresh();
          } else {
            toast.error(r.error);
          }
        });
      }}
      className={cn(
        "inline-flex items-center justify-center size-6 rounded-md transition-colors cursor-pointer disabled:opacity-50",
        watching ? "text-brand-strong hover:text-brand" : "text-faint hover:text-brand-strong",
        className
      )}
    >
      <Bookmark className={cn("size-4", watching && "fill-brand text-brand-strong")} />
    </button>
  );
}
