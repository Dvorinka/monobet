"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CATEGORIES } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const TABS = ["all", "trending", "new", ...CATEGORIES] as const;

export function CategoryTabs() {
  const params = useSearchParams();
  const active = params.get("cat") ?? "all";
  const q = params.get("q");

  return (
    <div className="scrollbar-none -mx-4 px-4 overflow-x-auto border-b border-line">
      <div className="flex gap-1 min-w-max">
        {TABS.map((t) => {
          const sp = new URLSearchParams();
          if (t !== "all") sp.set("cat", t);
          if (q) sp.set("q", q);
          const isActive = active.toLowerCase() === t.toLowerCase() || (t === "all" && active === "all");
          return (
            <Link
              key={t}
              href={`/?${sp.toString()}`}
              className={cn(
                "px-3.5 py-2.5 text-[13.5px] font-medium capitalize whitespace-nowrap border-b-2 -mb-px transition-colors",
                isActive ? "border-brand text-brand-strong" : "border-transparent text-mute hover:text-ink"
              )}
            >
              {t}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
