import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { getUserLedger } from "@/lib/queries";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { Card } from "@/components/ui/primitives";
import { fmtMarks, timeAgo } from "@/lib/money";
import { Gamepad2, Coins, Dices, Timer, Rocket, Disc3, Cherry, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Games" };

export default async function GamesPage() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect("/login");
  const t = getT(lang);
  const ledger = (await getUserLedger(user.id, 60)).filter((l) => l.kind === "game").slice(0, 12);

  const games = [
    { slug: "coinflip", icon: Coins, title: t.gCoinFlip, sub: t.gCoinFlipSub },
    { slug: "dice", icon: Dices, title: t.gDice, sub: t.gDiceSub },
    { slug: "timer", icon: Timer, title: t.gTimer, sub: t.gTimerSub },
    { slug: "limbo", icon: Rocket, title: t.gLimbo, sub: t.gLimboSub },
    { slug: "wheel", icon: Disc3, title: t.gWheel, sub: t.gWheelSub },
    { slug: "slots", icon: Cherry, title: t.gSlots, sub: t.gSlotsSub },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-10">
      <h1 className="text-[22px] font-bold tracking-tight flex items-center gap-2">
        <Gamepad2 className="size-5" /> {t.games}
      </h1>
      <p className="text-[13px] text-mute mt-1">{t.gamesSub}</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((g) => (
          <Link
            key={g.slug}
            href={`/games/${g.slug}`}
            className="group"
          >
            <Card className="p-5 h-full flex items-center gap-3.5 transition-all duration-150 hover:border-brand/40 hover:shadow-sm group-hover:-translate-y-0.5">
              <span className="size-11 rounded-xl bg-brand-soft text-brand-strong grid place-items-center shrink-0">
                <g.icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold tracking-tight">{g.title}</span>
                <span className="block text-[12px] text-faint leading-snug mt-0.5">{g.sub}</span>
              </span>
              <ChevronRight className="size-4 text-faint group-hover:text-ink transition-colors shrink-0" />
            </Card>
          </Link>
        ))}
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
