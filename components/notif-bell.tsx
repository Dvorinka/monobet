"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { fmtMarks, timeAgo } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";

export type NotifItem = {
  id: string;
  kind: string;
  amountCents: number;
  memo: string;
  createdAt: Date | string;
  slug: string | null;
};

const SEEN_KEY = "monobet.notifSeen";

export function NotifBell({ items, lang }: { items: NotifItem[]; lang?: Lang }) {
  const t = getT(lang ?? "en");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Last-read marker lives client-side — an account-level nicety, not data.
  // getSnapshot re-runs on every render, so opening the panel re-reads storage.
  const seen = useSyncExternalStore(
    () => () => {},
    () => Number(localStorage.getItem(SEEN_KEY) ?? 0),
    () => 0
  );

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const unseen = items.filter((i) => new Date(i.createdAt).getTime() > seen).length;

  const openPanel = () => {
    const next = !open;
    if (next) localStorage.setItem(SEEN_KEY, String(Date.now()));
    setOpen(next);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={openPanel}
        className="relative size-9 grid place-items-center rounded-lg text-mute hover:text-ink hover:bg-surface-2 transition cursor-pointer"
        aria-label={t.notifications}
      >
        <Bell className="size-[18px]" />
        {unseen > 0 && (
          <span className="absolute top-1 right-1 min-w-4 h-4 px-0.5 rounded-full bg-no text-no-on text-[9.5px] font-bold grid place-items-center">
            {unseen > 9 ? "9+" : unseen}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 w-80 rounded-xl border border-line bg-surface shadow-lg p-1.5 z-50 anim-rise max-h-[70vh] overflow-y-auto">
          {items.length === 0 && <p className="px-3.5 py-6 text-center text-[13px] text-mute">{t.noNotifs}</p>}
          {items.map((n) => {
            const inner = (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-surface-2">
                <Badge tone={n.kind === "liq" ? "no" : n.amountCents > 0 ? "yes" : "mute"} className="shrink-0">
                  {n.kind === "liq" ? t.kindLiq : n.amountCents > 0 ? `+${fmtMarks(n.amountCents, { lang, decimals: false })}` : n.kind}
                </Badge>
                <span className="text-[12.5px] text-mute flex-1 line-clamp-2">{n.memo || n.kind}</span>
                <span className="text-[10.5px] text-faint shrink-0">{timeAgo(new Date(n.createdAt), lang)}</span>
              </div>
            );
            return n.slug ? (
              <Link key={n.id} href={`/market/${n.slug}`} onClick={() => setOpen(false)}>{inner}</Link>
            ) : (
              <div key={n.id}>{inner}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
