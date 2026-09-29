import { Suspense } from "react";
import { CategoryTabs } from "@/components/category-tabs";
import { LiveRefresher } from "@/components/live-refresher";
import { TradeTicker } from "@/components/trade-ticker";
import { MarketCard } from "@/components/market-card";
import { listMarkets, getSparklines, getCommentCount, getGlobalTrades, getSiteStats, getGroupOptionsFor, listCategories } from "@/lib/queries";
import { fmtMarks } from "@/lib/money";
import { getCurrentUser, isAdmin } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT, LOCALES } from "@/lib/i18n";
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
  const lang = await getLang();
  const t = getT(lang);
  const [user, categories] = await Promise.all([getCurrentUser(), listCategories()]);
  const markets = await listMarkets({
    category: cat,
    q,
    sort: cat === "new" ? "new" : "trending",
    includePendingForUser: isAdmin(user) ? user!.id : undefined,
  });
  const ids = markets.map((m) => m.id);
  const groupIds = markets.filter((m) => m.kind === "group").map((m) => m.id);
  const [sparks, comments, ticker, stats, groupOptions] = await Promise.all([
    getSparklines(ids),
    getCommentCount(ids),
    getGlobalTrades(),
    getSiteStats(),
    getGroupOptionsFor(groupIds),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4">
      <LiveRefresher intervalMs={15000} />
      <Suspense>
        <CategoryTabs categories={categories} lang={lang} />
      </Suspense>
      <TradeTicker trades={ticker} lang={lang} />

      <div className="py-5 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[22px] font-bold tracking-tight">
          {q ? t.resultsFor(q) : cat === "all" ? t.allMarkets : t.headingCat(cat)}
        </h1>
        <span className="num text-[12.5px] text-mute font-medium">
          {fmtMarks(stats.volumeCents, { lang })} {t.traded} · {stats.trades.toLocaleString(LOCALES[lang])} {stats.trades === 1 ? t.bet : t.bets} · {stats.users} {stats.users === 1 ? t.traderSingular : t.traders} · {markets.length} {t.marketsN}
        </span>
      </div>

      {markets.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-line py-20 text-center">
          <p className="text-mute font-medium">{t.emptyMarkets}</p>
          <p className="text-[13px] text-faint mt-1">
            {t.beFirst} <a href="/propose" className="underline underline-offset-2 text-ink">{t.createOne}</a>.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {markets.map((m, i) => (
            <MarketCard key={m.id} market={m} spark={sparks.get(m.id) ?? []} comments={comments.get(m.id) ?? 0} index={i} options={groupOptions.get(m.id)} lang={lang} />
          ))}
        </div>
      )}
    </div>
  );
}
