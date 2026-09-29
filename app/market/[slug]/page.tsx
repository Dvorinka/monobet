import { notFound } from "next/navigation";
import Link from "next/link";
import { Clock, Users, Scale, CheckCircle2, XCircle, Hourglass } from "lucide-react";
import type { Metadata } from "next";
import {
  getMarketBySlug,
  getPriceHistory,
  getRecentTrades,
  getComments,
  getUserPosition,
  marketYesPrice,
} from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { fmtMarks, fmtDate, fmtShares } from "@/lib/money";
import { PriceChart } from "@/components/price-chart";
import { LiveRefresher } from "@/components/live-refresher";
import { TradeTicket } from "@/components/trade-ticket";
import { MarketTabs } from "@/components/market-tabs";
import { Comments } from "@/components/comments";
import { ActivityFeed } from "@/components/activity-feed";
import { Badge, Card } from "@/components/ui/primitives";

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

  const user = await getCurrentUser();
  // Pending markets are only visible to admin and their proposer.
  if (market.status === "pending" || market.status === "rejected") {
    const canSee = user && (user.role === "admin" || user.id === market.creatorId);
    if (!canSee) notFound();
  }

  const [history, trades, comments, position] = await Promise.all([
    getPriceHistory(market.id),
    getRecentTrades(market.id),
    getComments(market.id),
    user ? getUserPosition(market.id, user.id) : null,
  ]);

  const py = marketYesPrice(market);
  const heldYes = Number(position?.yesShares ?? 0);
  const heldNo = Number(position?.noShares ?? 0);
  const posValue = Math.round((heldYes * py + heldNo * (1 - py)) * 100);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-5">
      {market.status === "live" && <LiveRefresher intervalMs={8000} />}
      <div className="text-[12.5px] text-mute font-medium">
        <Link href="/" className="hover:text-ink">Markets</Link>
        <span className="mx-1.5">/</span>
        <Link href={`/?cat=${market.category}`} className="hover:text-ink">{market.category}</Link>
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
                Resolved {market.outcome?.toUpperCase()}
              </Badge>
            )}
            {market.status === "cancelled" && <Badge tone="mute" className="mt-1.5">Cancelled</Badge>}
            {market.status === "pending" && <Badge tone="warn" className="mt-1.5">Pending approval</Badge>}
            {market.status === "rejected" && <Badge tone="no" className="mt-1.5">Rejected</Badge>}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-[12.5px] text-mute font-medium">
            <span className="num">{fmtMarks(market.volumeCents)} volume</span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-3.5" /> {market.traderCount} traders
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" />
              {market.closesAt ? `Closes ${fmtDate(market.closesAt)}` : "No close date"}
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
                This market resolved <strong>{market.outcome?.toUpperCase()}</strong> on{" "}
                {fmtDate(market.resolvedAt)}. Winning shares paid out Ɱ1.00 each automatically.
              </p>
            </div>
          )}
          {market.status === "pending" && (
            <div className="mt-5 rounded-[14px] border border-dashed border-line p-4 flex items-center gap-3">
              <Hourglass className="size-5 text-amber-600 shrink-0" />
              <p className="text-sm text-mute">Waiting for an admin to approve this market before trading opens.</p>
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
                <Scale className="size-4" /> Rules
              </h2>
              <p className="text-sm text-ink-2 whitespace-pre-wrap leading-relaxed">{market.description}</p>
            </div>
          )}

          <div className="mt-8">
            <MarketTabs
              activity={<ActivityFeed trades={trades} />}
              comments={
                <Comments
                  marketId={market.id}
                  comments={comments}
                  signedIn={!!user}
                  currentUserId={user?.id}
                  isAdmin={user?.role === "admin"}
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
          />

          {(heldYes > 0.001 || heldNo > 0.001) && (
            <Card className="p-4">
              <h3 className="text-[13px] font-semibold text-mute uppercase tracking-wide">Your position</h3>
              <div className="mt-2.5 space-y-1.5 text-sm">
                {heldYes > 0.001 && (
                  <div className="flex justify-between">
                    <span className="text-yes-strong font-semibold">Yes</span>
                    <span className="num">{fmtShares(heldYes)} shares</span>
                  </div>
                )}
                {heldNo > 0.001 && (
                  <div className="flex justify-between">
                    <span className="text-no-strong font-semibold">No</span>
                    <span className="num">{fmtShares(heldNo)} shares</span>
                  </div>
                )}
                <div className="flex justify-between pt-1.5 border-t border-line-2">
                  <span className="text-mute">Current value</span>
                  <span className="num font-bold">{fmtMarks(posValue)}</span>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
