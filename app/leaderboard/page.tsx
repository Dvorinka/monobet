import type { Metadata } from "next";
import Link from "next/link";
import { getLeaderboard } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { fmtMarks } from "@/lib/money";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { Avatar, Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { Trophy } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leaderboard" };

export default async function LeaderboardPage() {
  const [rows, user, lang] = await Promise.all([getLeaderboard(), getCurrentUser(), getLang()]);
  const t = getT(lang);

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8">
      <h1 className="text-[22px] font-bold tracking-tight flex items-center gap-2">
        <Trophy className="size-5" /> {t.lbTitle}
      </h1>
      <p className="text-[13px] text-mute mt-1">{t.lbSub}</p>

      <Card className="mt-6 overflow-hidden">
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
    </div>
  );
}
