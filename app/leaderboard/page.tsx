import type { Metadata } from "next";
import Link from "next/link";
import { ensureSeason, getLeaderboard, getSeasonHistory, getSquads } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { fmtMarks, fmtDate, fmtCountdown } from "@/lib/money";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { Avatar, Badge, Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { CalendarClock, Medal, Trophy, Users } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leaderboard" };

const MEDALS = ["text-amber-500", "text-slate-400", "text-amber-700"];

export default async function LeaderboardPage() {
  const [season, rows, user, lang, history, squads] = await Promise.all([
    ensureSeason(),
    getLeaderboard(),
    getCurrentUser(),
    getLang(),
    getSeasonHistory(4),
    getSquads(),
  ]);
  const t = getT(lang);

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-10">
      <h1 className="text-[22px] font-bold tracking-tight flex items-center gap-2">
        <Trophy className="size-5" /> {t.lbTitle}
      </h1>
      <p className="text-[13px] text-mute mt-1">{t.lbSub}</p>

      <Card className="mt-5 px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="size-9 rounded-lg bg-brand-soft text-brand-strong flex items-center justify-center shrink-0">
          <CalendarClock className="size-4.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold">{t.seasonLive(season.index)}</div>
          <div className="text-[12px] text-mute">
            {t.seasonEndsIn(fmtCountdown(season.endsAt))} · {t.seasonPrize}
          </div>
        </div>
        <Badge tone="warn" className="text-[11px]">{fmtDate(season.endsAt, lang)}</Badge>
      </Card>

      <Card className="mt-4 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-mute">
              <th className="px-4 py-2.5 w-12">#</th>
              <th className="px-4 py-2.5">{t.lbTrader}</th>
              <th className="px-4 py-2.5 text-right">{t.lbPositions}</th>
              <th className="px-4 py-2.5 text-right">{t.lbBalance}</th>
              <th className="px-4 py-2.5 text-right">{t.lbNetWorth}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-2">
            {rows.map((r, i) => (
              <tr key={r.id} className={cn(user?.id === r.id && "bg-yes-soft/40")}>
                <td className="num px-4 py-3 font-bold">
                  <span className={cn(i === 0 && "text-amber-500", i === 1 && "text-slate-400", i === 2 && "text-amber-700", i > 2 && "text-mute")}>
                    {i + 1}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/u/${r.username ?? r.name}`} className="flex items-center gap-2.5 hover:underline underline-offset-2">
                    <Avatar name={r.username ?? r.name} image={r.image} className="size-7" />
                    <span className="font-medium">
                      @{r.username ?? r.name}
                      {user?.id === r.id && <span className="text-yes-strong text-[11px] font-semibold ml-1.5">{t.lbYou}</span>}
                    </span>
                  </Link>
                </td>
                <td className="num px-4 py-3 text-right text-mute">{fmtMarks(r.portfolioCents, { lang })}</td>
                <td className="num px-4 py-3 text-right text-mute">{fmtMarks(r.balanceCents, { lang })}</td>
                <td className="num px-4 py-3 text-right font-bold">{fmtMarks(r.netWorthCents, { lang })}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-mute">
                  {t.lbEmpty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {squads.length > 0 && (
        <section className="mt-6">
          <h2 className="text-[15px] font-semibold mb-3 flex items-center gap-1.5">
            <Users className="size-4" /> {t.squadsTitle}
          </h2>
          <Card className="p-1.5">
            {squads.map((s, i) => (
              <div key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className={cn("num w-6 text-[13px] font-bold", i === 0 ? "text-amber-500" : "text-mute")}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold">{s.name}</div>
                  <div className="text-[11.5px] text-faint truncate">
                    {s.memberCount} · {s.members.slice(0, 6).map((m) => `@${m}`).join(", ")}
                    {s.memberCount > 6 ? "…" : ""}
                  </div>
                </div>
                <span className="num text-[13px] font-bold">{fmtMarks(s.netWorthCents, { lang })}</span>
              </div>
            ))}
          </Card>
        </section>
      )}

      {history.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[15px] font-semibold mb-3">{t.seasonPast}</h2>
          <div className="space-y-3">
            {history.map(({ season: s, podium }) => (
              <Card key={s.id} className="px-4 py-3">
                <div className="text-[12px] font-semibold text-mute mb-2">
                  {t.seasonLive(s.index)} · {fmtDate(s.startsAt, lang)} – {fmtDate(s.endsAt, lang)}
                </div>
                <div className="flex flex-wrap gap-2">
                  {podium.map((r) => (
                    <Link
                      key={r.rank}
                      href={`/u/${r.username ?? r.name}`}
                      className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 hover:bg-surface-3"
                    >
                      <Medal className={cn("size-4", MEDALS[r.rank - 1] ?? "text-mute")} />
                      <Avatar name={r.username ?? r.name} image={r.image} className="size-5" />
                      <span className="text-[12.5px] font-medium">@{r.username ?? r.name}</span>
                      <span className="num text-[12px] font-bold text-yes">+{fmtMarks(r.rewardCents, { lang, decimals: false })}</span>
                    </Link>
                  ))}
                  {podium.length === 0 && <span className="text-[12px] text-faint">{t.lbEmpty}</span>}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
