import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { getUserLedger } from "@/lib/queries";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { GamesPanel } from "@/components/games-panel";
import { Card } from "@/components/ui/primitives";
import { fmtMarks, timeAgo } from "@/lib/money";
import { Gamepad2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Games" };

export default async function GamesPage() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect("/login");
  const t = getT(lang);
  const ledger = (await getUserLedger(user.id, 60)).filter((l) => l.kind === "game").slice(0, 12);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-10">
      <h1 className="text-[22px] font-bold tracking-tight flex items-center gap-2">
        <Gamepad2 className="size-5" /> {t.games}
      </h1>
      <p className="text-[13px] text-mute mt-1">{t.gamesSub}</p>

      <div className="mt-6">
        <GamesPanel balanceCents={user.balanceCents} lang={lang} />
      </div>

      <section className="mt-10">
        <h2 className="text-[15px] font-semibold mb-3">{t.recentGames}</h2>
        <Card className="p-1.5">
          {ledger.length === 0 && <p className="p-4 text-sm text-mute">{t.noGames}</p>}
          {ledger.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <span className="truncate text-mute flex-1">{l.memo || "game"}</span>
              <span className={cn("num font-semibold", l.amountCents > 0 ? "text-yes-strong" : "text-ink")}>
                {l.amountCents > 0 ? "+" : ""}
                {fmtMarks(l.amountCents, { lang })}
              </span>
              <span className="text-faint text-[11px] w-14 text-right">{timeAgo(l.createdAt, lang)}</span>
            </div>
          ))}
        </Card>
      </section>

      <p className="mt-8 text-[12px] text-faint leading-relaxed max-w-2xl">{t.fairNote}</p>
    </div>
  );
}
