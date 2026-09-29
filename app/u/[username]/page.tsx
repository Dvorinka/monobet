import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getAchievements, getPublicProfile } from "@/lib/queries";
import { getCurrentUser, isAdmin } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { Avatar, Badge, Card } from "@/components/ui/primitives";
import { fmtMarks, fmtDate, fmtShares } from "@/lib/money";
import { marketYesPrice } from "@/lib/queries";
import { CheckCircle2, Lock, ShieldCheck, Trophy } from "lucide-react";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${decodeURIComponent(username)}` };
}

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const [profile, viewer, lang] = await Promise.all([
    getPublicProfile(decodeURIComponent(username)),
    getCurrentUser(),
    getLang(),
  ]);
  if (!profile) notFound();
  const t = getT(lang);
  const { user: u, stats, positions, created, netWorthCents, rank } = profile;
  const achievements = await getAchievements(u.id);
  const isSelf = viewer?.id === u.id;

  const achMeta: Record<string, { title: string; desc: string }> = {
    portfolio: { title: t.bonusPortfolio, desc: t.bonusPortfolioDesc },
    instagram: { title: t.bonusInstagram, desc: t.bonusInstagramDesc },
    github: { title: t.bonusGithub, desc: t.bonusGithubDesc },
    first_bet: { title: t.bonusFirstBet, desc: t.bonusFirstBetDesc },
    first_market: { title: t.bonusFirstMarket, desc: t.bonusFirstMarketDesc },
    first_comment: { title: t.bonusFirstComment, desc: t.bonusFirstCommentDesc },
    streak_7: { title: t.achStreak7, desc: t.achStreak7Desc },
    trades_10: { title: t.achTrades10, desc: t.achTrades10Desc },
    trades_50: { title: t.achTrades50, desc: t.achTrades50Desc },
    markets_5: { title: t.achMarkets5, desc: t.achMarkets5Desc },
    comments_10: { title: t.achComments10, desc: t.achComments10Desc },
    season_podium: { title: t.achPodium, desc: t.achPodiumDesc },
    whale: { title: t.achWhale, desc: t.achWhaleDesc },
  };

  return (
    <div className="mx-auto max-w-4xl px-4 pt-8 pb-10">
      {/* Identity card */}
      <Card className="p-5 flex items-center gap-4 flex-wrap">
        <Avatar name={u.username ?? u.name} image={u.image} className="size-16 text-2xl" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[20px] font-bold tracking-tight">@{u.username ?? u.name}</h1>
            {isAdmin(u) && <Badge tone="yes"><ShieldCheck className="size-3" /> {t.umAdmin}</Badge>}
            {isSelf && <Badge tone="ink">{t.umYou}</Badge>}
            {rank > 0 && <Badge tone="warn"><Trophy className="size-3" /> #{rank}</Badge>}
          </div>
          <div className="text-[12.5px] text-mute mt-0.5">
            {t.joined} {fmtDate(u.createdAt, lang)}
          </div>
        </div>
        <div className="text-right">
          <div className="num text-[24px] font-bold leading-none">{fmtMarks(netWorthCents, { lang })}</div>
          <div className="text-[11px] text-mute mt-1">{t.lbNetWorth}</div>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        <Stat label={t.lbBalance} value={fmtMarks(u.balanceCents, { lang })} />
        <Stat label={t.lbPositions} value={fmtMarks(positions.reduce((s, p) => s + p.valueCents, 0), { lang })} />
        <Stat label={t.trades} value={String(stats.trades)} />
        <Stat label={t.markets} value={String(stats.markets)} />
      </div>

      {/* Achievements */}
      <section className="mt-8">
        <h2 className="text-[15px] font-semibold mb-3">{t.achievements}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {achievements.map((a) => {
            const meta = achMeta[a.key] ?? { title: a.key, desc: "" };
            return (
              <Card key={a.key} className={`p-3.5 ${a.unlocked ? "" : "opacity-60"}`}>
                <div className="flex items-center gap-2">
                  {a.unlocked ? (
                    <CheckCircle2 className="size-4 text-yes shrink-0" />
                  ) : (
                    <Lock className="size-4 text-faint shrink-0" />
                  )}
                  <span className="text-[13px] font-semibold truncate">{meta.title}</span>
                </div>
                <div className="text-[11.5px] text-mute mt-1 line-clamp-2">{meta.desc}</div>
                {!a.unlocked && a.progress > 0 && (
                  <div className="mt-2 h-1 rounded-full bg-surface-3 overflow-hidden">
                    <div className="h-full bg-brand" style={{ width: `${Math.round(a.progress * 100)}%` }} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2 mt-8">
        {/* Open positions */}
        <section>
          <h2 className="text-[15px] font-semibold mb-3">{t.openPositions}</h2>
          <Card className="p-1.5">
            {positions.length === 0 && <p className="p-4 text-sm text-mute">{t.noPositions}</p>}
            {positions.map((p) => {
              return (
                <Link
                  key={p.market.id}
                  href={`/market/${p.market.slug}`}
                  className="block px-3 py-2.5 rounded-lg hover:bg-surface-2"
                >
                  <div className="text-[13px] font-medium line-clamp-1">{p.market.question}</div>
                  <div className="text-[11.5px] text-mute mt-0.5 flex items-center gap-2">
                    {p.yesShares > 0.001 && (
                      <Badge tone="yes" className="text-[10px] px-1.5 py-0">YES ×{fmtShares(p.yesShares, lang)}</Badge>
                    )}
                    {p.noShares > 0.001 && (
                      <Badge tone="no" className="text-[10px] px-1.5 py-0">NO ×{fmtShares(p.noShares, lang)}</Badge>
                    )}
                    <span className="num ml-auto font-semibold text-ink">{fmtMarks(p.valueCents, { lang })}</span>
                  </div>
                </Link>
              );
            })}
          </Card>
        </section>

        {/* Markets created */}
        <section>
          <h2 className="text-[15px] font-semibold mb-3">{t.marketsCreated}</h2>
          <Card className="p-1.5">
            {created.length === 0 && <p className="p-4 text-sm text-mute">{t.noCreated}</p>}
            {created.map((m) => (
              <Link
                key={m.id}
                href={`/market/${m.slug}`}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium line-clamp-1">{m.question}</div>
                  <div className="text-[11.5px] text-mute mt-0.5">
                    {fmtMarks(m.volumeCents, { lang })} {t.vol.toLowerCase()}
                  </div>
                </div>
                <Badge
                  tone={m.status === "live" ? "yes" : m.status === "resolved" ? "ink" : m.status === "pending" ? "warn" : "mute"}
                >
                  {m.status === "live"
                    ? `${Math.round(marketYesPrice(m) * 100)}%`
                    : m.status === "resolved"
                      ? (m.outcome ?? "—").toUpperCase()
                      : m.status}
                </Badge>
              </Link>
            ))}
          </Card>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-[11.5px] font-medium text-mute">{label}</div>
      <div className="num mt-1 text-[19px] font-bold">{value}</div>
    </Card>
  );
}
