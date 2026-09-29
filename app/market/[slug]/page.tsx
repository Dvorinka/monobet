import { notFound } from "next/navigation";
import Link from "next/link";
import { Clock, Users, Scale, CheckCircle2, XCircle, Hourglass } from "lucide-react";
import type { Metadata } from "next";
import {
  getMarketBySlug,
  getMarketById,
  getPriceHistory,
  getRecentTrades,
  getGroupTrades,
  getGroupOptions,
  getComments,
  getUserPosition,
  getRelatedMarkets,
  getSparklines,
  marketYesPrice,
} from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT, type Dict } from "@/lib/i18n";
import { fmtMarks, fmtDate, fmtShares, fmtCents } from "@/lib/money";
import { PriceChart } from "@/components/price-chart";
import { LiveRefresher } from "@/components/live-refresher";
import { TradeTicket } from "@/components/trade-ticket";
import { MarketTabs } from "@/components/market-tabs";
import { Comments } from "@/components/comments";
import { ActivityFeed } from "@/components/activity-feed";
import { Badge, Card } from "@/components/ui/primitives";
import { MarketCard, MarketIcon } from "@/components/market-card";
import { Sparkline } from "@/components/sparkline";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const m = await getMarketBySlug(slug);
  return { title: m?.question ?? "Market" };
}

export default async function MarketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const market = await getMarketBySlug(slug);
  if (!market) notFound();

  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  const t = getT(lang);
  // Pending markets are only visible to admin and their proposer.
  if (market.status === "pending" || market.status === "rejected") {
    const canSee = user && (user.role === "admin" || user.id === market.creatorId);
    if (!canSee) notFound();
  }

  if (market.kind === "group") {
    const [options, trades, comments, related] = await Promise.all([
      getGroupOptions(market.id),
      getGroupTrades(market.id),
      getComments(market.id),
      getRelatedMarkets(market.id, market.category),
    ]);
    return <GroupMarketView market={market} options={options} trades={trades} comments={comments} related={related} user={user} lang={lang} />;
  }

  const parent = market.parentId ? await getMarketById(market.parentId) : null;

  const [history, trades, comments, position, related] = await Promise.all([
    getPriceHistory(market.id),
    getRecentTrades(market.id),
    getComments(market.id),
    user ? getUserPosition(market.id, user.id) : null,
    getRelatedMarkets(market.id, market.category),
  ]);
  const relatedSparks = await getSparklines(related.map((m) => m.id));

  const py = marketYesPrice(market);
  const heldYes = Number(position?.yesShares ?? 0);
  const heldNo = Number(position?.noShares ?? 0);
  const posValue = Math.round((heldYes * py + heldNo * (1 - py)) * 100);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-5">
      {market.status === "live" && <LiveRefresher intervalMs={8000} />}
      <div className="text-[12.5px] text-mute font-medium">
        <Link href="/" className="hover:text-ink">{t.markets}</Link>
        <span className="mx-1.5">/</span>
        <Link href={`/?cat=${market.category}`} className="hover:text-ink">{market.category}</Link>
        {parent && (
          <>
            <span className="mx-1.5">/</span>
            <Link href={`/market/${parent.slug}`} className="hover:text-ink truncate max-w-56 inline-block align-bottom">{parent.question}</Link>
            {market.label && (
              <>
                <span className="mx-1.5">/</span>
                <span className="text-ink-2">{market.label}</span>
              </>
            )}
          </>
        )}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_340px]">
        {/* left column */}
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <h1 className="text-[24px] sm:text-[28px] font-bold tracking-tight leading-tight flex-1">
              {market.question}
            </h1>
            {market.status === "resolved" && (
              <Badge tone={market.outcome === "yes" ? "yes" : "no"} className="mt-1.5">
                {t.resolved} {(market.outcome === "yes" ? t.yes : t.no).toUpperCase()}
              </Badge>
            )}
            {market.status === "cancelled" && <Badge tone="mute" className="mt-1.5">{t.cancelled}</Badge>}
            {market.status === "pending" && <Badge tone="warn" className="mt-1.5">{t.pendingApproval}</Badge>}
            {market.status === "rejected" && <Badge tone="no" className="mt-1.5">{t.rejected}</Badge>}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-[12.5px] text-mute font-medium">
            <span className="num">{fmtMarks(market.volumeCents, { lang })} {t.volume}</span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-3.5" /> {market.traderCount} {t.tradersW}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" />
              {market.closesAt ? `${t.closes} ${fmtDate(market.closesAt, lang)}` : t.noCloseDate}
            </span>
          </div>

          {market.status === "resolved" && (
            <div className="mt-5 rounded-[14px] border border-line bg-surface-2 p-4 flex items-center gap-3">
              {market.outcome === "yes" ? (
                <CheckCircle2 className="size-5 text-yes shrink-0" />
              ) : (
                <XCircle className="size-5 text-no shrink-0" />
              )}
              <p className="text-sm">
                {t.resolvedBanner((market.outcome === "yes" ? t.yes : t.no).toUpperCase(), fmtDate(market.resolvedAt, lang))}
              </p>
            </div>
          )}
          {market.status === "pending" && (
            <div className="mt-5 rounded-[14px] border border-dashed border-line p-4 flex items-center gap-3">
              <Hourglass className="size-5 text-amber-600 shrink-0" />
              <p className="text-sm text-mute">{t.pendingBanner}</p>
            </div>
          )}

          <div className="mt-6">
            <PriceChart
              points={history.map((h) => ({ t: h.t.toISOString(), p: Number(h.p) }))}
              // eslint-disable-next-line react-hooks/purity -- server component renders once per request
              now={Date.now()}
              live={market.status === "live"}
            />
          </div>

          {market.description && (
            <div className="mt-8">
              <h2 className="text-[15px] font-semibold mb-2 inline-flex items-center gap-2">
                <Scale className="size-4" /> {t.rules}
              </h2>
              <p className="text-sm text-ink-2 whitespace-pre-wrap leading-relaxed">{market.description}</p>
            </div>
          )}

          <div className="mt-8">
            <MarketTabs
              lang={lang}
              activity={<ActivityFeed trades={trades} lang={lang} />}
              comments={
                <Comments
                  marketId={market.id}
                  comments={comments}
                  signedIn={!!user}
                  currentUserId={user?.id}
                  isAdmin={user?.role === "admin"}
                  lang={lang}
                />
              }
              commentCount={comments.length}
              tradeCount={trades.length}
            />
          </div>
        </div>

        {/* right column */}
        <div className="space-y-4 lg:sticky lg:top-20 self-start">
          <TradeTicket
            marketId={market.id}
            qYes={Number(market.qYes)}
            qNo={Number(market.qNo)}
            b={market.b}
            live={market.status === "live"}
            signedIn={!!user}
            userBalanceCents={user?.balanceCents ?? null}
            heldYes={heldYes}
            heldNo={heldNo}
            lang={lang}
          />

          {(heldYes > 0.001 || heldNo > 0.001) && (
            <Card className="p-4 anim-rise">
              <h3 className="text-[13px] font-semibold text-mute uppercase tracking-wide">{t.yourPosition}</h3>
              <div className="mt-2.5 space-y-1.5 text-sm">
                {heldYes > 0.001 && (
                  <div className="flex justify-between">
                    <span className="text-yes-strong font-semibold">{t.yes}</span>
                    <span className="num">{fmtShares(heldYes, lang)} {t.sharesUnit}</span>
                  </div>
                )}
                {heldNo > 0.001 && (
                  <div className="flex justify-between">
                    <span className="text-no-strong font-semibold">{t.no}</span>
                    <span className="num">{fmtShares(heldNo, lang)} {t.sharesUnit}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1.5 border-t border-line-2">
                  <span className="text-mute">{t.currentValue}</span>
                  <span className="num font-bold">{fmtMarks(posValue, { lang })}</span>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <div className="mt-12 border-t border-line pt-8">
          <h2 className="text-[15px] font-bold tracking-tight mb-4">{t.moreMarkets(market.category)}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((m, i) => (
              <MarketCard key={m.id} market={m} spark={relatedSparks.get(m.id) ?? []} index={i} lang={lang} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- multi-outcome group page ----------

async function GroupMarketView({
  market,
  options,
  trades,
  comments,
  related,
  user,
  lang,
}: {
  market: Awaited<ReturnType<typeof getMarketBySlug>> & object;
  options: Awaited<ReturnType<typeof getGroupOptions>>;
  trades: Awaited<ReturnType<typeof getGroupTrades>>;
  comments: Awaited<ReturnType<typeof getComments>>;
  related: Awaited<ReturnType<typeof getRelatedMarkets>>;
  user: Awaited<ReturnType<typeof getCurrentUser>>;
  lang: "en" | "cs";
}) {
  const t: Dict = getT(lang);
  const relatedSparks = await getSparklines(related.map((m) => m.id));
  const optionSparks = await getSparklines(options.map((o) => o.id));
  const live = options.filter((o) => o.status === "live");
  const closed = options.filter((o) => o.status !== "live");
  const volume = options.reduce((s, o) => s + o.volumeCents, 0);
  const traders = options.reduce((s, o) => s + o.traderCount, 0);
  const anyLive = live.length > 0;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-5">
      {anyLive && <LiveRefresher intervalMs={8000} />}
      <div className="text-[12.5px] text-mute font-medium">
        <Link href="/" className="hover:text-ink">{t.markets}</Link>
        <span className="mx-1.5">/</span>
        <Link href={`/?cat=${market.category}`} className="hover:text-ink">{market.category}</Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-2">{options.length} {t.options}</span>
      </div>

      <div className="mt-6 flex items-start gap-4">
        <MarketIcon market={market} size="size-12" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] sm:text-[28px] font-bold tracking-tight leading-tight">
            {market.question}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[12.5px] text-mute font-medium">
            <span className="num">{fmtMarks(volume, { lang })} {t.volume}</span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-3.5" /> {traders} {t.tradersW}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" />
              {market.closesAt ? `${t.closes} ${fmtDate(market.closesAt, lang)}` : t.noCloseDate}
            </span>
            {anyLive && (
              <Badge tone="yes" className="uppercase">
                <span className="live-dot" /> {t.live}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-[14px] border border-line bg-surface overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto] sm:grid-cols-[1fr_110px_110px_64px_150px] items-center gap-3 px-4 py-2.5 border-b border-line text-[11px] font-semibold uppercase tracking-wide text-faint">
          <span>{t.option}</span>
          <span className="hidden sm:block text-right">{t.volume}</span>
          <span className="hidden sm:block text-right">{t.tradersW}</span>
          <span className="text-right">{t.chance}</span>
          <span className="hidden sm:block" />
        </div>
        <div className="divide-y divide-line-2">
          {live.map((o) => {
            const py = marketYesPrice(o);
            return (
              <Link
                key={o.id}
                href={`/market/${o.slug}`}
                className="grid grid-cols-[1fr_auto_auto_auto] sm:grid-cols-[1fr_110px_110px_64px_150px] items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors"
              >
                <span className="min-w-0 flex items-center gap-3">
                  <span className="text-[14px] font-semibold text-ink truncate">{o.label}</span>
                  <Sparkline points={optionSparks.get(o.id) ?? []} className="hidden md:block shrink-0 opacity-80" />
                </span>
                <span className="num hidden sm:block text-right text-[12.5px] text-mute">{fmtMarks(o.volumeCents, { lang })}</span>
                <span className="num hidden sm:block text-right text-[12.5px] text-mute">{o.traderCount}</span>
                <span className={cn("num text-right text-[15px] font-bold", py >= 0.5 ? "text-yes" : "text-ink")}>
                  {Math.round(py * 100)}%
                </span>
                <span className="hidden sm:grid grid-cols-2 gap-1.5">
                  <span className="num grid place-items-center h-8 rounded-md bg-yes-soft text-yes-strong text-[12px] font-semibold">
                    {t.yes} {fmtCents(py)}
                  </span>
                  <span className="num grid place-items-center h-8 rounded-md bg-no-soft text-no-strong text-[12px] font-semibold">
                    {t.no} {fmtCents(1 - py)}
                  </span>
                </span>
              </Link>
            );
          })}
          {live.length === 0 && (
            <p className="px-4 py-6 text-[13px] text-mute">{t.allClosed}</p>
          )}
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
                  <span className="text-[14px] font-medium text-mute truncate flex-1">{o.label}</span>
                  <span className="num text-[12px] text-faint">{fmtMarks(o.volumeCents, { lang })} {t.vol}</span>
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

      {market.description && (
        <div className="mt-8">
          <h2 className="text-[15px] font-semibold mb-2 inline-flex items-center gap-2">
            <Scale className="size-4" /> {t.rules}
          </h2>
          <p className="text-sm text-ink-2 whitespace-pre-wrap leading-relaxed">{market.description}</p>
        </div>
      )}

      <div className="mt-8">
        <MarketTabs
          lang={lang}
          activity={<ActivityFeed trades={trades} lang={lang} />}
          comments={
            <Comments
              marketId={market.id}
              comments={comments}
              signedIn={!!user}
              currentUserId={user?.id}
              isAdmin={user?.role === "admin"}
              lang={lang}
            />
          }
          commentCount={comments.length}
          tradeCount={trades.length}
        />
      </div>

      {related.length > 0 && (
        <div className="mt-12 border-t border-line pt-8">
          <h2 className="text-[15px] font-bold tracking-tight mb-4">{t.moreMarkets(market.category)}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((m, i) => (
              <MarketCard key={m.id} market={m} spark={relatedSparks.get(m.id) ?? []} index={i} lang={lang} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
