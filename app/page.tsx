import { Suspense } from "react";
import { CategoryTabs } from "@/components/category-tabs";
import { LiveRefresher } from "@/components/live-refresher";
import { TradeTicker } from "@/components/trade-ticker";
import { MarketCard } from "@/components/market-card";
import { listMarkets, getSparklines, getCommentCount, getGlobalTrades, getSiteStats } from "@/lib/queries";
import { fmtMarks } from "@/lib/money";
import { getCurrentUser } from "@/lib/session";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Markets" };

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const cat = sp.cat ?? "all";
  const q = sp.q;
  const user = await getCurrentUser();
  const markets = await listMarkets({
    category: cat,
    q,
    sort: cat === "new" ? "new" : "trending",
    includePendingForUser: user?.role === "admin" ? user.id : undefined,
  });
  const ids = markets.map((m) => m.id);
  const [sparks, comments, ticker, stats] = await Promise.all([
    getSparklines(ids),
    getCommentCount(ids),
    getGlobalTrades(),
    getSiteStats(),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4">
      <LiveRefresher intervalMs={15000} />
      <Suspense>
        <CategoryTabs />
      </Suspense>
      <TradeTicker trades={ticker} />

      <div className="py-5 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[22px] font-bold tracking-tight capitalize">
          {q ? `Results for “${q}”` : cat === "all" ? "All markets" : cat === "trending" ? "Trending" : cat === "new" ? "Newest" : cat}
        </h1>
        <span className="num text-[12.5px] text-mute font-medium">
          {fmtMarks(stats.volumeCents)} traded · {stats.trades.toLocaleString()} {stats.trades === 1 ? "bet" : "bets"} · {stats.users} {stats.users === 1 ? "trader" : "traders"} · {markets.length} markets
        </span>
      </div>

      {markets.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-line py-20 text-center">
          <p className="text-mute font-medium">No markets here yet.</p>
          <p className="text-[13px] text-faint mt-1">
            Be the first — <a href="/propose" className="underline underline-offset-2 text-ink">create one</a>.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {markets.map((m, i) => (
            <MarketCard key={m.id} market={m} spark={sparks.get(m.id) ?? []} comments={comments.get(m.id) ?? 0} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
