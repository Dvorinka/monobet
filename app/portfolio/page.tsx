import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { getUserPositions, getUserTrades, getUserLedger, marketYesPrice } from "@/lib/queries";
import { fmtMarks, fmtCents, fmtShares, timeAgo } from "@/lib/money";
import { Badge, Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { Wallet, TrendingUp, Landmark, ListOrdered } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Portfolio" };

export default async function PortfolioPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [positions, trades, ledger] = await Promise.all([
    getUserPositions(user.id),
    getUserTrades(user.id),
    getUserLedger(user.id, 30),
  ]);

  const portfolioCents = positions.reduce((s, p) => s + p.valueCents, 0);
  const netWorth = user.balanceCents + portfolioCents;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8">
      <h1 className="text-[22px] font-bold tracking-tight">Portfolio</h1>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Stat icon={<Wallet className="size-4" />} label="Cash balance" value={fmtMarks(user.balanceCents)} />
        <Stat icon={<TrendingUp className="size-4" />} label="Positions value" value={fmtMarks(portfolioCents)} />
        <Stat icon={<Landmark className="size-4" />} label="Net worth" value={fmtMarks(netWorth)} highlight />
      </div>

      <section className="mt-10">
        <h2 className="text-[16px] font-semibold mb-3">Positions</h2>
        {positions.length === 0 ? (
          <Card className="p-6 text-center text-sm text-mute">
            No open positions. <Link href="/" className="text-ink font-semibold underline underline-offset-2">Browse markets</Link>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-mute">
                  <th className="px-4 py-2.5 font-semibold">Market</th>
                  <th className="px-4 py-2.5 font-semibold">Side</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Shares</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Price</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {positions.flatMap((p) => {
                  const py = marketYesPrice(p.market);
                  const rows = [];
                  if (p.yesShares > 0.001)
                    rows.push(
                      <PositionRow
                        key={`${p.market.id}-y`}
                        slug={p.market.slug}
                        question={p.market.question}
                        side="Yes"
                        shares={p.yesShares}
                        price={p.market.status === "resolved" ? (p.market.outcome === "yes" ? 1 : 0) : py}
                        status={p.market.status}
                      />
                    );
                  if (p.noShares > 0.001)
                    rows.push(
                      <PositionRow
                        key={`${p.market.id}-n`}
                        slug={p.market.slug}
                        question={p.market.question}
                        side="No"
                        shares={p.noShares}
                        price={p.market.status === "resolved" ? (p.market.outcome === "no" ? 1 : 0) : 1 - py}
                        status={p.market.status}
                      />
                    );
                  return rows;
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="text-[16px] font-semibold mb-3 flex items-center gap-2">
            <ListOrdered className="size-4" /> Recent trades
          </h2>
          <Card className="p-1.5">
            {trades.length === 0 && <p className="p-4 text-sm text-mute">No trades yet.</p>}
            {trades.map(({ trade: t, question, slug }) => (
              <Link
                key={t.id}
                href={`/market/${slug}`}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-surface-2 text-[13px]"
              >
                <Badge tone={t.outcome === "yes" ? "yes" : "no"}>{t.outcome.toUpperCase()}</Badge>
                <span className={cn("font-medium", t.side === "buy" ? "text-ink" : "text-mute")}>{t.side}</span>
                <span className="num text-mute">{fmtShares(Number(t.shares))}</span>
                <span className="truncate text-mute flex-1">{question}</span>
                <span className="num font-semibold">{fmtMarks(t.amountCents)}</span>
                <span className="text-faint text-[11px] w-14 text-right">{timeAgo(t.createdAt)}</span>
              </Link>
            ))}
          </Card>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold mb-3">Cash flow</h2>
          <Card className="p-1.5">
            {ledger.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                <KindBadge kind={l.kind} />
                <span className="truncate text-mute flex-1">{l.memo || l.kind}</span>
                <span className={cn("num font-semibold", l.amountCents > 0 ? "text-yes-strong" : "text-ink")}>
                  {l.amountCents > 0 ? "+" : ""}
                  {fmtMarks(l.amountCents)}
                </span>
                <span className="num text-faint text-[11.5px] w-20 text-right">
                  → {fmtMarks(l.balanceAfterCents)}
                </span>
              </div>
            ))}
          </Card>
        </section>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-mute">
        {icon}
        {label}
      </div>
      <div className={cn("num mt-1 text-[26px] font-bold tracking-tight", highlight && "text-yes-strong")}>{value}</div>
    </Card>
  );
}

function PositionRow({
  slug,
  question,
  side,
  shares,
  price,
  status,
}: {
  slug: string;
  question: string;
  side: "Yes" | "No";
  shares: number;
  price: number;
  status: string;
}) {
  return (
    <tr>
      <td className="px-4 py-3">
        <Link href={`/market/${slug}`} className="font-medium hover:underline underline-offset-2 line-clamp-1">
          {question}
        </Link>
        {status !== "live" && <div className="text-[11px] text-faint capitalize">{status}</div>}
      </td>
      <td className="px-4 py-3">
        <Badge tone={side === "Yes" ? "yes" : "no"}>{side}</Badge>
      </td>
      <td className="num px-4 py-3 text-right">{fmtShares(shares)}</td>
      <td className="num px-4 py-3 text-right">{fmtCents(price)}</td>
      <td className="num px-4 py-3 text-right font-semibold">{fmtMarks(Math.round(shares * price * 100))}</td>
    </tr>
  );
}

function KindBadge({ kind }: { kind: string }) {
  const map: Record<string, { label: string; tone: "yes" | "no" | "ink" | "mute" | "warn" }> = {
    signup: { label: "Bonus", tone: "ink" },
    claim: { label: "Claim", tone: "ink" },
    grant: { label: "Grant", tone: "ink" },
    buy: { label: "Buy", tone: "mute" },
    sell: { label: "Sell", tone: "mute" },
    payout: { label: "Payout", tone: "yes" },
    refund: { label: "Refund", tone: "warn" },
  };
  const { label, tone } = map[kind] ?? { label: kind, tone: "mute" as const };
  return <Badge tone={tone}>{label}</Badge>;
}
