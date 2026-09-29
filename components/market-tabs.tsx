"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export function MarketTabs({
  activity,
  comments,
  commentCount,
  tradeCount,
}: {
  activity: React.ReactNode;
  comments: React.ReactNode;
  commentCount: number;
  tradeCount: number;
}) {
  const [tab, setTab] = useState<"activity" | "comments">("activity");
  const btn = (key: "activity" | "comments", label: string, n: number) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      className={cn(
        "px-3.5 py-2.5 text-[13.5px] font-medium border-b-2 -mb-px transition-colors cursor-pointer",
        tab === key ? "border-ink text-ink" : "border-transparent text-mute hover:text-ink"
      )}
    >
      {label} <span className="num text-faint">{n}</span>
    </button>
  );
  return (
    <div>
      <div className="flex border-b border-line">
        {btn("activity", "Activity", tradeCount)}
        {btn("comments", "Comments", commentCount)}
      </div>
      <div className="pt-5">{tab === "activity" ? activity : comments}</div>
    </div>
  );
}
