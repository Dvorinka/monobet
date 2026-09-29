"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/primitives";
import { OptionChip } from "@/components/market-icon";
import { Sparkline } from "@/components/sparkline";
import { TradeTicket } from "@/components/trade-ticket";
import { ResolutionPanel } from "@/components/resolution-panel";
import { yesPrice } from "@/lib/lmsr";
import { fmtMonos } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { cn, slugifyLabel } from "@/lib/utils";

export type GroupOption = {
  id: string;
  slug: string;
  label: string;
  imageUrl: string | null;
  status: string;
  outcome: string | null;
  qYes: number;
  qNo: number;
  b: number;
  volumeCents: number;
  traderCount: number;
  index: number;
  proposedOutcome?: string | null;
  proposedById?: string | null;
  resolutionReason?: string | null;
};

export type ResolutionState = { confirms: number; disputes: number; myVote: string | null; proposer: string | null };

// Client-side option selection — picking an outcome swaps the ticket without a
// server round-trip, so it feels instant. ?opt= stays in the URL via
// replaceState so selection remains shareable.
export function GroupTrade({
  slug,
  options,
  sparks,
  positions,
  balanceCents,
  signedIn,
  maxLeverage,
  lang,
  initialOpt,
  initialSide,
  resStates,
  viewerId,
  isResolver,
  parentClosed,
  chart,
  left,
  rail,
}: {
  slug: string;
  options: GroupOption[];
  sparks: Record<string, number[]>;
  positions: Record<string, { yes: number; no: number }>;
  balanceCents: number | null;
  signedIn: boolean;
  maxLeverage: number;
  lang?: Lang;
  initialOpt?: string;
  initialSide?: string;
  resStates?: Record<string, ResolutionState>;
  viewerId?: string;
  isResolver?: boolean;
  parentClosed?: boolean;
  chart?: React.ReactNode;
  left?: React.ReactNode;
  rail?: React.ReactNode;
}) {
  const t = getT(lang ?? "en");
  const live = options.filter((o) => o.status === "live");
  const closed = options.filter((o) => o.status !== "live");
  // ?opt= accepts the option label slug (readable), the child market slug, or the id (legacy links).
  const byOpt = (o: GroupOption) => o.id === initialOpt || o.slug === initialOpt || slugifyLabel(o.label) === initialOpt;
  const [selId, setSelId] = useState(() => live.find(byOpt)?.id ?? live[0]?.id ?? "");
  const [side, setSide] = useState<"yes" | "no">(initialSide === "no" ? "no" : "yes");

  const sel = live.find((o) => o.id === selId) ?? live[0];
  const selPos = sel ? positions[sel.id] : undefined;

  const select = (o: GroupOption, s?: "yes" | "no") => {
    setSelId(o.id);
    if (s) setSide(s);
    // Shareable URL without a server fetch — slugged option label.
    window.history.replaceState(null, "", `/market/${slug}?opt=${slugifyLabel(o.label)}${s ? `&side=${s}` : ""}`);
  };

  const ticket = sel && (
    <TradeTicket
      key={`${sel.id}:${side}`}
      marketId={sel.id}
      qYes={sel.qYes}
      qNo={sel.qNo}
      b={sel.b}
      live
      signedIn={signedIn}
      userBalanceCents={balanceCents}
      heldYes={selPos?.yes ?? 0}
      heldNo={selPos?.no ?? 0}
      maxLeverage={maxLeverage}
      lang={lang}
      defaultOutcome={side}
      title={
        <div className="mb-3 flex items-center gap-2.5">
          <OptionChip label={sel.label} index={sel.index} imageUrl={sel.imageUrl} />
          <span className="min-w-0 flex-1 text-[14px] font-semibold truncate">{sel.label}</span>
          <span className="num text-[15px] font-bold shrink-0">
            {Math.round(yesPrice(sel.qYes, sel.qNo, sel.b) * 100)}%
          </span>
        </div>
      }
    />
  );

  return (
    <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0">
        {chart}

        <div className="mt-8 rounded-[14px] border border-line bg-surface overflow-hidden">
          <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_110px_110px_64px_150px] items-center gap-3 px-4 py-2.5 border-b border-line text-[11px] font-semibold uppercase tracking-wide text-faint">
            <span>{t.option}</span>
            <span className="hidden sm:block text-right">{t.volume}</span>
            <span className="hidden sm:block text-right">{t.tradersW}</span>
            <span className="text-right">{t.chance}</span>
            <span className="hidden sm:block" />
          </div>
          <div className="divide-y divide-line-2">
            {live.map((o) => {
              const py = yesPrice(o.qYes, o.qNo, o.b);
              const active = sel?.id === o.id;
              return (
                <div
                  key={o.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => select(o)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      select(o);
                    }
                  }}
                  className={cn(
                    "grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_110px_110px_64px_150px] items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors cursor-pointer",
                    active && "bg-surface-2 shadow-[inset_2px_0_0_var(--brand)]"
                  )}
                >
                  <span className="min-w-0 flex items-center gap-3">
                    <OptionChip label={o.label} index={o.index} imageUrl={o.imageUrl} />
                    <span className="text-[14px] font-semibold text-ink truncate">{o.label}</span>
                    <Sparkline points={sparks[o.id] ?? []} className="hidden md:block shrink-0 opacity-80" />
                  </span>
                  <span className="num hidden sm:block text-right text-[12.5px] text-mute">
                    {fmtMonos(o.volumeCents, { lang })}
                  </span>
                  <span className="num hidden sm:block text-right text-[12.5px] text-mute">{o.traderCount}</span>
                  <span className={cn("num text-right text-[15px] font-bold", py >= 0.5 ? "text-yes" : "text-ink")}>
                    {Math.round(py * 100)}%
                  </span>
                  <span className="hidden sm:grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        select(o, "yes");
                      }}
                      className="num grid place-items-center h-8 px-1.5 rounded-md bg-yes-soft text-yes-strong text-[12px] font-semibold whitespace-nowrap hover:brightness-95 transition cursor-pointer"
                    >
                      {t.yes} {fmtMonos(Math.round(py * 100), { lang })}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        select(o, "no");
                      }}
                      className="num grid place-items-center h-8 px-1.5 rounded-md bg-no-soft text-no-strong text-[12px] font-semibold whitespace-nowrap hover:brightness-95 transition cursor-pointer"
                    >
                      {t.no} {fmtMonos(Math.round((1 - py) * 100), { lang })}
                    </button>
                  </span>
                </div>
              );
            })}
            {live.length === 0 && <p className="px-4 py-6 text-[13px] text-mute">{t.allClosed}</p>}
          </div>
          {closed.length > 0 && (
            <details className="border-t border-line">
              <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-semibold text-mute hover:text-ink select-none">
                {t.viewResolved(closed.length)}
              </summary>
              <div className="divide-y divide-line-2 border-t border-line-2">
                {closed.map((o) => (
                  <Link
                    key={o.id}
                    href={`/market/${o.slug}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors"
                  >
                    <OptionChip label={o.label} index={o.index} imageUrl={o.imageUrl} />
                    <span className="text-[14px] font-medium text-mute truncate flex-1">{o.label}</span>
                    <span className="num text-[12px] text-faint">
                      {fmtMonos(o.volumeCents, { lang })} {t.vol}
                    </span>
                    <Badge tone={o.status === "resolved" ? (o.outcome === "yes" ? "yes" : "no") : "mute"}>
                      {o.status === "resolved"
                        ? `${(o.outcome === "yes" ? t.yes : t.no).toUpperCase()} ${t.won}`
                        : t.cancelled}
                    </Badge>
                  </Link>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* Community resolution for the selected option — the poll is always
            visible; the resolver declares, everyone else confirms/disputes. */}
        {sel && (
          <div className="mt-4">
            <ResolutionPanel
              marketId={sel.id}
              proposedOutcome={sel.proposedOutcome ?? null}
              reason={sel.resolutionReason ?? ""}
              proposer={resStates?.[sel.id]?.proposer ?? null}
              proposedById={sel.proposedById ?? null}
              viewerId={viewerId}
              confirms={resStates?.[sel.id]?.confirms ?? 0}
              disputes={resStates?.[sel.id]?.disputes ?? 0}
              myVote={resStates?.[sel.id]?.myVote ?? null}
              closed={parentClosed ?? false}
              isResolver={isResolver ?? false}
              contextLabel={sel.label}
              lang={lang}
            />
          </div>
        )}

        {/* On phones the ticket and rail (other markets, manage) sit right
            under the options; on desktop they live in the sticky column. */}
        {ticket && <div className="mt-4 lg:hidden">{ticket}</div>}
        <div className="mt-4 space-y-4 lg:hidden">{rail}</div>

        {left}
      </div>

      <div className="space-y-4 lg:sticky lg:top-20 self-start max-lg:hidden">
        {ticket}
        {rail}
      </div>
    </div>
  );
}
