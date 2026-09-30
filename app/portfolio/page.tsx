import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { getUserPositions, getUserTrades, getUserLedger, marketYesPrice } from "@/lib/queries";
import { fmtMonos, fmtCents, fmtShares, timeAgo } from "@/lib/money";
import { Badge, Card } from "@/components/ui/primitives";
import { AnimatedMoney } from "@/components/animated-number";
import { getLang } from "@/lib/lang-server";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Wallet, TrendingUp, Landmark, ListOrdered } from "lucide-react";
import { AvatarUpload } from "@/components/avatar-upload";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Portfolio" };

export default async function PortfolioPage() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect("/login");
  const t = getT(lang);

  const [positions, trades, ledger] = await Promise.all([
    getUserPositions(user.id),
    getUserTrades(user.id),
    getUserLedger(user.id, 30),
  ]);

  const portfolioCents = positions.reduce((s, p) => s + p.valueCents, 0);
  const netWorth = user.balanceCents + portfolioCents;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8">
      <div className="flex items-center gap-4">
        <AvatarUpload name={user.username ?? user.name} image={user.image} lang={lang} />
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">@{user.username ?? user.name}</h1>
          <p className="text-[12.5px] text-mute">{t.portfolio}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Stat icon={<Wallet className="size-4" />} label={t.cashBalance} value={<AnimatedMoney cents={user.balanceCents} lang={lang} />} />
        <Stat icon={<TrendingUp className="size-4" />} label={t.positionsValue} value={<AnimatedMoney cents={portfolioCents} lang={lang} />} />
        <Stat icon={<Landmark className="size-4" />} label={t.netWorth} value={<AnimatedMoney cents={netWorth} lang={lang} />} highlight />
      </div>

      <section className="mt-10">
        <h2 className="text-[16px] font-semibold mb-3">{t.positions}</h2>
        {positions.length === 0 ? (
          <Card className="p-6 text-center text-sm text-mute">
            {t.noPositions} <Link href="/" className="text-ink font-semibold underline underline-offset-2">{t.browseMarkets}</Link>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-mute">
                  <th className="px-4 py-2.5 font-semibold">{t.market}</th>
                  <th className="px-4 py-2.5 font-semibold">{t.side}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t.sharesLabel}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t.price}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t.value}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {positions.flatMap((p) => {
                  const py = marketYesPrice(p.market);
                  const rows = [];
                  let debtShown = false;
                  const takeDebt = () => (debtShown ? 0 : ((debtShown = true), p.debtCents));
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
                        debtCents={takeDebt()}
                        lang={lang}
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
                        debtCents={takeDebt()}
                        lang={lang}
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
            <ListOrdered className="size-4" /> {t.recentTrades}
          </h2>
          <Card className="p-1.5">
            {trades.length === 0 && <p className="p-4 text-sm text-mute">{t.noTrades}</p>}
            {trades.map(({ trade: tr, question, slug }) => (
              <Link
                key={tr.id}
                href={`/market/${slug}`}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-surface-2 text-[13px]"
              >
                <Badge tone={tr.outcome === "yes" ? "yes" : "no"}>
                  {(tr.outcome === "yes" ? t.yes : t.no).toUpperCase()}
                </Badge>
                <span className={cn("font-medium", tr.side === "buy" ? "text-ink" : "text-mute")}>
                  {tr.side === "buy" ? t.buy.toLowerCase() : t.sell.toLowerCase()}
                </span>
                <span className="num text-mute">{fmtShares(Number(tr.shares), lang)}</span>
                <span className="truncate text-mute flex-1">{question}</span>
                <span className="num font-semibold">{fmtMonos(tr.amountCents, { lang })}</span>
                <span className="text-faint text-[11px] w-14 text-right">{timeAgo(tr.createdAt, lang)}</span>
              </Link>
            ))}
          </Card>
        </section>

        <section>
          <h2 className="text-[16px] font-semibold mb-3">{t.cashFlow}</h2>
          <Card className="p-1.5">
            {ledger.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                <KindBadge kind={l.kind} lang={lang} />
                <span className="truncate text-mute flex-1">{l.memo || l.kind}</span>
                <span className={cn("num font-semibold", l.amountCents > 0 ? "text-yes-strong" : "text-ink")}>
                  {l.amountCents > 0 ? "+" : ""}
                  {fmtMonos(l.amountCents, { lang })}
                </span>
                <span className="num text-faint text-[11.5px] w-20 text-right">
                  → {fmtMonos(l.balanceAfterCents, { lang })}
                </span>
              </div>
            ))}
          </Card>
        </section>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <Card className="p-4 anim-rise">
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
  debtCents,
  lang,
}: {
  slug: string;
  question: string;
  side: "Yes" | "No";
  shares: number;
  price: number;
  status: string;
  debtCents?: number;
  lang?: Lang;
}) {
  const t = getT(lang ?? "en");
  const statusLabel =
    status === "resolved" ? t.resolved : status === "cancelled" ? t.cancelled : status === "pending" ? t.pendingApproval : status;
  return (
    <tr>
      <td className="px-4 py-3">
        <Link href={`/market/${slug}`} className="font-medium hover:underline underline-offset-2 line-clamp-1">
          {question}
        </Link>
        {status !== "live" && <div className="text-[11px] text-faint">{statusLabel}</div>}
      </td>
      <td className="px-4 py-3">
        <Badge tone={side === "Yes" ? "yes" : "no"}>{side === "Yes" ? t.yes : t.no}</Badge>
      </td>
      <td className="num px-4 py-3 text-right">{fmtShares(shares, lang)}</td>
      <td className="num px-4 py-3 text-right">{fmtCents(price)}</td>
      <td className="num px-4 py-3 text-right font-semibold">
        {fmtMonos(Math.round(shares * price * 100), { lang })}
        {/* position loan rides the whole position — surface it once, on the
            first side row, so gross value stays honest */}
        {(debtCents ?? 0) > 0 && (
          <div className="num text-[11px] font-medium text-no-strong">−{fmtMonos(debtCents!, { lang })} {t.kindLoan.toLowerCase()}</div>
        )}
      </td>
    </tr>
  );
}

function KindBadge({ kind, lang }: { kind: string; lang?: Lang }) {
  const t = getT(lang ?? "en");
  const map: Record<string, { label: string; tone: "yes" | "no" | "ink" | "mute" | "warn" }> = {
    signup: { label: t.kindBonus, tone: "ink" },
    claim: { label: t.kindClaim, tone: "ink" },
    grant: { label: t.kindGrant, tone: "ink" },
    buy: { label: t.kindBuy, tone: "mute" },
    sell: { label: t.kindSell, tone: "mute" },
    payout: { label: t.kindPayout, tone: "yes" },
    refund: { label: t.kindRefund, tone: "warn" },
    weekly: { label: t.kindClaim, tone: "ink" },
    ad: { label: t.kindBonus, tone: "ink" },
    bonus: { label: t.kindBonus, tone: "ink" },
    game: { label: t.kindGame, tone: "ink" },
    liq: { label: t.kindLiq, tone: "no" },
    duel: { label: t.kindDuel, tone: "warn" },
    loan: { label: t.kindLoan, tone: "warn" },
    repay: { label: t.kindRepay, tone: "yes" },
    burn: { label: t.kindBurn, tone: "mute" },
    debt: { label: t.kindDebt, tone: "no" },
  };
  const { label, tone } = map[kind] ?? { label: kind, tone: "mute" as const };
  return <Badge tone={tone}>{label}</Badge>;
}
