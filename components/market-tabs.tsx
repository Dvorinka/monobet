"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { getT, type Lang } from "@/lib/i18n";

export function MarketTabs({
  activity,
  comments,
  commentCount,
  tradeCount,
  lang,
}: {
  activity: React.ReactNode;
  comments: React.ReactNode;
  commentCount: number;
  tradeCount: number;
  lang?: Lang;
}) {
  const t = getT(lang ?? "en");
  const [tab, setTab] = useState<"activity" | "comments">("activity");
  const btn = (key: "activity" | "comments", label: string, n: number) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      className={cn(
        "px-3.5 py-2.5 text-[13.5px] font-medium border-b-2 -mb-px transition-colors cursor-pointer",
        tab === key ? "border-brand text-brand-strong" : "border-transparent text-mute hover:text-ink"
      )}
    >
      {label} <span className="num text-faint">{n}</span>
    </button>
  );
  return (
    <div>
      <div className="flex border-b border-line">
        {btn("activity", t.activity, tradeCount)}
        {btn("comments", t.comments, commentCount)}
      </div>
      <div className="pt-5">{tab === "activity" ? activity : comments}</div>
    </div>
  );
}
