"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Tabs come from the DB — "trending"/"new" are special filters, the rest are
// user-creatable categories.
export function CategoryTabs({ categories, lang }: { categories: string[]; lang?: Lang }) {
  const t = getT(lang ?? "en");
  const params = useSearchParams();
  const active = params.get("cat") ?? "all";
  const q = params.get("q");
  const tabs: { key: string; label: string }[] = [
    { key: "all", label: t.tabAll },
    { key: "trending", label: t.tabTrending },
    { key: "new", label: t.tabNew },
    ...categories.map((c) => ({ key: c, label: c })),
  ];

  return (
    <div className="scrollbar-none -mx-4 px-4 overflow-x-auto border-b border-line">
      <div className="flex gap-1 min-w-max">
        {tabs.map((tab) => {
          const sp = new URLSearchParams();
          if (tab.key !== "all") sp.set("cat", tab.key);
          if (q) sp.set("q", q);
          const isActive =
            active.toLowerCase() === tab.key.toLowerCase() || (tab.key === "all" && active === "all");
          return (
            <Link
              key={tab.key}
              href={`/?${sp.toString()}`}
              className={cn(
                "px-3.5 py-2.5 text-[13.5px] font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                isActive ? "border-brand text-brand-strong" : "border-transparent text-mute hover:text-ink"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
