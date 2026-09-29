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
  getMyPositions,
  getPositionBadges,
  getRelatedMarkets,
  getSparklines,
  getGroupHistories,
  getMarketBetCount,
  listCategories,
  isLiked,
  getLikeCounts,
  marketYesPrice,
  getResolutionState,
  getTopHolders,
  getUserPublic,
} from "@/lib/queries";
import { getCurrentUser, isAdmin } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT, type Dict } from "@/lib/i18n";
import { fmtMarks, fmtDate, fmtShares } from "@/lib/money";
import { PriceChart } from "@/components/price-chart";
import { LikeButton } from "@/components/like-button";
import { CopyLink } from "@/components/copy-link";
import { LiveRefresher } from "@/components/live-refresher";
import { TradeTicket } from "@/components/trade-ticket";
import { MarketTabs } from "@/components/market-tabs";
import { Comments } from "@/components/comments";
import { ActivityFeed } from "@/components/activity-feed";
import { Badge, Card, Avatar } from "@/components/ui/primitives";
import { MarketIcon } from "@/components/market-icon";
import { GroupTrade } from "@/components/group-trade";
import { MultiPriceChart } from "@/components/multi-chart";
import { DeleteMarketButton } from "@/components/delete-market-button";
import { MarketManagePanel } from "@/components/market-manage";
import { ResolutionPanel } from "@/components/resolution-panel";
import { optionColor } from "@/lib/option-style";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const m = await getMarketBySlug(slug);
  const pct = m ? Math.round(marketYesPrice(m) * 100) : 0;
  return {
    title: m?.question ?? "Market",
    description: m ? `${pct}% YES · ${fmtMarks(m.volumeCents)} traded on MonoBet — play-money markets` : "MonoBet market",
    openGraph: m ? { title: m.question } : undefined,
  };
}

export default async function MarketPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ opt?: string; side?: string }> }) {
  const { slug } = await params;
  const { opt: selOpt, side: selSide } = await searchParams;
  const market = await getMarketBySlug(slug);
  if (!market) notFound();

  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  const t = getT(lang);
  // Pending markets are only visible to admin and their proposer.
  if (market.status === "pending" || market.status === "rejected") {
    const canSee = user && (isAdmin(user) || user.id === market.creatorId);
    if (!canSee) notFound();
  }

  if (market.kind === "group") {
    const [options, trades, comments, related, liked, likes] = await Promise.all([
      getGroupOptions(market.id),
      getGroupTrades(market.id),
      getComments(market.id, user?.id),
      getRelatedMarkets(market.id, market.category),
      user ? isLiked(user.id, market.id) : false,
      getLikeCounts([market.id]),
    ]);
    return <GroupMarketView market={market} options={options} trades={trades} comments={comments} related={related} user={user} lang={lang} liked={liked} likes={likes.get(market.id) ?? 0} selOpt={selOpt} selSide={selSide} />;
  }

  const parent = market.parentId ? await getMarketById(market.parentId) : null;

  const [history, trades, comments, position, related, betCount, categories, res, liked, likes, holders, creator, posBadges] = await Promise.all([
    getPriceHistory(market.id),
    getRecentTrades(market.id),
    getComments(market.id, user?.id),
    user ? getUserPosition(market.id, user.id) : null,
    getRelatedMarkets(market.id, market.category),
    getMarketBetCount(market.id),
    listCategories(),
    getResolutionState(market.id, user?.id),
    user ? isLiked(user.id, market.id) : false,
    getLikeCounts([market.id]),
    getTopHolders(market.id),
    getUserPublic(market.creatorId),
    getPositionBadges([market.id]),
  ]);
  const canDelete = !!user && (isAdmin(user) || (market.creatorId === user.id && betCount === 0));
  const canManage = !!user && (isAdmin(user) || market.creatorId === user.id);

  // Comment badges: each commenter's dominant side on this market.
  const badges: Record<string, { label: string; shares: number; tone: "yes" | "no" }> = {};
  for (const p of posBadges) {
    const yes = Number(p.yesShares);
    const no = Number(p.noShares);
    if (Math.max(yes, no) < 0.01) continue;
    badges[p.userId] = yes >= no
      ? { label: t.yes.toUpperCase(), shares: yes, tone: "yes" }
      : { label: t.no.toUpperCase(), shares: no, tone: "no" };
  }

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
          <div className="flex items-start gap-3.5">
            <MarketIcon market={market} size="size-12" />
            <h1 className="text-[24px] sm:text-[28px] font-bold tracking-tight leading-tight flex-1">
              {market.question}
            </h1>
            {user && (
              <span className="mt-1.5 inline-flex items-center gap-1 shrink-0">
                <LikeButton marketId={market.id} liked={liked} count={likes.get(market.id) ?? 0} lang={lang} />
              </span>
            )}
            {market.status === "resolved" && (
              <Badge tone={market.outcome === "yes" ? "yes" : "no"} className="mt-1.5">
                {t.resolved} {(market.outcome === "yes" ? t.yes : t.no).toUpperCase()}
              </Badge>
            )}
            {market.status === "cancelled" && <Badge tone="mute" className="mt-1.5">{t.cancelled}</Badge>}
            {market.status === "pending" && <Badge tone="warn" className="mt-1.5">{t.pendingApproval}</Badge>}
            {market.status === "rejected" && <Badge tone="no" className="mt-1.5">{t.rejected}</Badge>}
            {canDelete && (
              <DeleteMarketButton marketId={market.id} question={market.question} admin={isAdmin(user)} lang={lang} />
            )}
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
                {market.resolutionReason && (
                  <span className="block text-[12px] text-mute mt-0.5">{market.resolutionReason}</span>
                )}
              </p>
            </div>
          )}
          {market.status === "live" && market.closesAt && market.closesAt < new Date() && (
            <div className="mt-5">
              <ResolutionPanel
                marketId={market.id}
                proposedOutcome={market.proposedOutcome}
                reason={market.resolutionReason}
                proposer={res.proposer}
                proposedById={market.proposedById}
                viewerId={user?.id}
                confirms={res.confirms}
                disputes={res.disputes}
                myVote={res.myVote}
                lang={lang}
              />
            </div>
          )}
          {market.status === "pending" && (
            <div className="mt-5 rounded-[14px] border border-dashed border-line p-4 flex items-center gap-3">
              <Hourglass className="size-5 text-amber-600 shrink-0" />
              <p className="text-sm text-mute">{t.pendingBanner}</p>
            </div>
          )}

          {/* chart + the Polymarket-style stats strip underneath */}
          <div className="mt-5 rounded-[14px] border border-line bg-surface p-4">
            <PriceChart
              points={history.map((h) => ({ t: h.t.toISOString(), p: Number(h.p) }))}
              // eslint-disable-next-line react-hooks/purity -- server component renders once per request
              now={Date.now()}
              live={market.status === "live"}
              lang={lang}
            />
            <div className="mt-3 pt-3 border-t border-line-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-mute font-medium">
              <span className="num font-semibold text-ink-2">{fmtMarks(market.volumeCents, { lang })} {t.volume}</span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-3.5" /> {market.traderCount} {t.tradersW}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5" />
                {market.closesAt ? `${t.closes} ${fmtDate(market.closesAt, lang)}` : t.noCloseDate}
              </span>
              <span className="inline-flex items-center gap-1.5">
                {t.openedAt} {fmtDate(market.createdAt, lang)}
              </span>
              <CopyLink path={`/market/${market.slug}`} lang={lang} />
            </div>
          </div>

          {/* Mobile ticket — sits right under the chart; the sticky rail copy
              takes over on desktop. */}
          <div className="mt-4 lg:hidden">
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
              maxLeverage={market.maxLeverage}
              lang={lang}
            />
          </div>

          {/* rules + market context, Polymarket-style tabs block */}
          <div className="mt-8">
            <h2 className="text-[15px] font-semibold mb-2 inline-flex items-center gap-2">
              <Scale className="size-4" /> {t.rules} · {t.marketContext}
            </h2>
            {market.description ? (
              <p className="text-sm text-ink-2 whitespace-pre-wrap leading-relaxed">{market.description}</p>
            ) : (
              <p className="text-sm text-faint">{t.resolverNote}.</p>
            )}
            <Card className="mt-3 p-4">
              <dl className="grid gap-2.5 text-[13px] sm:grid-cols-2">
                <div className="flex items-center gap-2.5">
                  {creator && <Avatar name={creator.name} image={creator.image} className="size-7" />}
                  <div className="min-w-0">
                    <dt className="text-[11px] uppercase tracking-wide text-faint font-semibold">{t.creator}</dt>
                    <dd className="font-medium truncate">
                      {creator ? (
                        <Link href={`/u/${creator.username ?? ""}`} className="hover:text-brand-strong">
                          @{creator.username ?? creator.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  {creator && <Avatar name={creator.name} image={creator.image} className="size-7" />}
                  <div className="min-w-0">
                    <dt className="text-[11px] uppercase tracking-wide text-faint font-semibold">{t.resolver}</dt>
                    <dd className="font-medium truncate">
                      {res.proposer ? `@${res.proposer}` : creator ? `@${creator.username ?? creator.name}` : "—"}
                      <span className="block text-[11px] font-normal text-faint">{t.resolverNote}</span>
                    </dd>
                  </div>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-faint font-semibold">{t.openedAt}</dt>
                  <dd className="font-medium num">{fmtDate(market.createdAt, lang)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-faint font-semibold">{t.closes}</dt>
                  <dd className="font-medium num">
                    {market.closesAt ? fmtDate(market.closesAt, lang) : t.noCloseDate}
                  </dd>
                </div>
              </dl>
            </Card>
          </div>

          {holders.length > 0 && (
            <div className="mt-8">
              <h2 className="text-[15px] font-semibold mb-2">{t.topHolders}</h2>
              <Card className="p-1.5">
                {holders.slice(0, 8).map((h) => {
                  const yes = Number(h.yesShares);
                  const no = Number(h.noShares);
                  const side = yes >= no;
                  return (
                    <div key={h.username ?? h.name} className="flex items-center gap-3 px-3 py-2">
                      <Avatar name={h.name} image={h.image} className="size-7" />
                      <Link href={`/u/${h.username ?? ""}`} className="text-[13px] font-medium truncate flex-1 hover:text-brand-strong">
                        @{h.username ?? h.name}
                      </Link>
                      <span className={cn("num text-[12.5px] font-semibold", side ? "text-yes-strong" : "text-no-strong")}>
                        {fmtShares(side ? yes : no, lang)} {side ? t.yes : t.no}
                      </span>
                    </div>
                  );
                })}
              </Card>
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
                  viewerName={user?.username ?? user?.name}
                  viewerImage={user?.image}
                  isAdmin={isAdmin(user)}
                  lang={lang}
                  badges={badges}
                />
              }
              commentCount={comments.length}
              tradeCount={trades.length}
            />
          </div>
        </div>

        {/* right column */}
        <div className="space-y-4 lg:sticky lg:top-20 self-start">
          <div className="hidden lg:block">
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
              maxLeverage={market.maxLeverage}
              lang={lang}
            />
          </div>

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

          {canManage && market.status !== "resolved" && (
            <MarketManagePanel market={market} categories={categories} betCount={betCount} lang={lang} />
          )}

          {related.length > 0 && (
            <Card className="p-1.5">
              <h3 className="px-2.5 pt-2 pb-1 text-[12px] font-semibold uppercase tracking-wide text-faint">
                {t.relatedMarkets}
              </h3>
              <div className="divide-y divide-line-2">
                {related.slice(0, 6).map((m) => (
                  <Link
                    key={m.id}
                    href={`/market/${m.slug}`}
                    className="flex items-center gap-2.5 px-2.5 py-2.5 hover:bg-surface-2 rounded-lg transition-colors"
                  >
                    <MarketIcon market={m} size="size-8" />
                    <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug line-clamp-2">{m.question}</span>
                    <span className="num text-[13px] font-bold text-ink-2 shrink-0">
                      {Math.round(marketYesPrice(m) * 100)}%
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
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
  liked,
  likes = 0,
  selOpt,
  selSide,
}: {
  market: Awaited<ReturnType<typeof getMarketBySlug>> & object;
  options: Awaited<ReturnType<typeof getGroupOptions>>;
  trades: Awaited<ReturnType<typeof getGroupTrades>>;
  comments: Awaited<ReturnType<typeof getComments>>;
  related: Awaited<ReturnType<typeof getRelatedMarkets>>;
  user: Awaited<ReturnType<typeof getCurrentUser>>;
  lang: "en" | "cs";
  liked: boolean;
  likes?: number;
  selOpt?: string;
  selSide?: string;
}) {
  const t: Dict = getT(lang);
  const optionIds = options.map((o) => o.id);
  const live = options.filter((o) => o.status === "live");
  const [optionSparks, histories, betCount, categories, posRows, myPositions] = await Promise.all([
    getSparklines(optionIds),
    getGroupHistories(optionIds),
    getMarketBetCount(market.id),
    listCategories(),
    getPositionBadges(optionIds),
    user ? getMyPositions(user.id, optionIds) : {},
  ]);
  // Comment badges: each commenter's dominant option position. YES-side holders
  // get the option color, NO-side holders a red "No <option>" tag.
  const badges: Record<string, { label: string; shares: number; tone: "yes" | "no"; color?: string }> = {};
  for (const p of posRows) {
    const yes = Number(p.yesShares);
    const no = Number(p.noShares);
    const dom = Math.max(yes, no);
    if (dom < 0.01) continue;
    const prev = badges[p.userId];
    if (prev && prev.shares >= dom) continue;
    const oi = options.findIndex((o) => o.id === p.marketId);
    if (oi < 0) continue;
    const label = options[oi].label ?? options[oi].question;
    badges[p.userId] =
      yes >= no
        ? { label, shares: yes, tone: "yes", color: optionColor(oi) }
        : { label: `${t.no} ${label}`, shares: no, tone: "no" };
  }
  const volume = options.reduce((s, o) => s + o.volumeCents, 0);
  const traders = options.reduce((s, o) => s + o.traderCount, 0);
  const anyLive = live.length > 0;
  const canDelete = !!user && (isAdmin(user) || (market.creatorId === user.id && betCount === 0));
  const canManage = !!user && (isAdmin(user) || market.creatorId === user.id);
  // Multi-line chart: every option with a price history, colored by sort order
  // — resolved options stay as flat lines pinned at 0%/100%.
  const series = options
    .map((o, i) => ({
      key: o.id,
      label: o.label ?? o.question,
      color: optionColor(i),
      points: histories.get(o.id) ?? [],
    }))
    .filter((s) => s.points.length > 0);

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
          <h1 className="text-[24px] sm:text-[28px] font-bold tracking-tight leading-tight flex items-start gap-2">
            <span className="flex-1">{market.question}</span>
            {user && (
              <span className="mt-1.5 inline-flex items-center gap-1 shrink-0">
                <LikeButton marketId={market.id} liked={liked} count={likes} lang={lang} />
              </span>
            )}
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
        {canDelete && (
          <DeleteMarketButton marketId={market.id} question={market.question} admin={isAdmin(user)} lang={lang} />
        )}
      </div>

      <GroupTrade
        slug={market.slug}
        options={options.map((o, i) => ({
          id: o.id,
          slug: o.slug,
          label: o.label ?? o.question,
          imageUrl: o.imageUrl,
          status: o.status,
          outcome: o.outcome,
          qYes: Number(o.qYes),
          qNo: Number(o.qNo),
          b: o.b,
          volumeCents: o.volumeCents,
          traderCount: o.traderCount,
          index: i,
        }))}
        sparks={Object.fromEntries(optionSparks)}
        positions={myPositions}
        balanceCents={user?.balanceCents ?? null}
        signedIn={!!user}
        maxLeverage={market.maxLeverage}
        lang={lang}
        initialOpt={selOpt}
        initialSide={selSide}
        chart={
          series.length > 0 ? (
            <div className="rounded-[14px] border border-line bg-surface p-4">
              <MultiPriceChart
                series={series}
                // eslint-disable-next-line react-hooks/purity -- server component renders once per request
                now={Date.now()}
                live={anyLive}
                lang={lang}
              />
            </div>
          ) : null
        }
        left={
          <>
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
                    viewerName={user?.username ?? user?.name}
                    viewerImage={user?.image}
                    isAdmin={isAdmin(user)}
                    lang={lang}
                    badges={badges}
                  />
                }
                commentCount={comments.length}
                tradeCount={trades.length}
              />
            </div>
          </>
        }
        rail={
          <>
            {related.length > 0 && (
              <Card className="p-1.5">
                <h3 className="px-2.5 pt-2 pb-1 text-[12px] font-semibold uppercase tracking-wide text-faint">
                  {t.relatedMarkets}
                </h3>
                <div className="divide-y divide-line-2">
                  {related.slice(0, 6).map((m) => (
                    <Link
                      key={m.id}
                      href={`/market/${m.slug}`}
                      className="flex items-center gap-2.5 px-2.5 py-2.5 hover:bg-surface-2 rounded-lg transition-colors"
                    >
                      <MarketIcon market={m} size="size-8" />
                      <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug line-clamp-2">{m.question}</span>
                      <span className="num text-[13px] font-bold text-ink-2 shrink-0">
                        {Math.round(marketYesPrice(m) * 100)}%
                      </span>
                    </Link>
                  ))}
                </div>
              </Card>
            )}

            {canManage && market.status !== "resolved" && (
              <MarketManagePanel market={market} categories={categories} betCount={betCount} lang={lang} />
            )}
          </>
        }
      />
    </div>
  );
}
