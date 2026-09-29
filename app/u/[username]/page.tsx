import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getPublicProfile } from "@/lib/queries";
import { getCurrentUser, isAdmin } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { Avatar, Badge, Card } from "@/components/ui/primitives";
import { fmtMarks, fmtDate, fmtShares } from "@/lib/money";
import { marketYesPrice } from "@/lib/queries";
import { ShieldCheck, Trophy } from "lucide-react";

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
  const isSelf = viewer?.id === u.id;

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
