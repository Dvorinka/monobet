import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { accruedDebtCents } from "@/lib/loans";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { GameView, type GameSlug } from "@/components/games-panel";
import { SessionChip } from "@/components/session-chip";
import { LiveRefresher } from "@/components/live-refresher";
import { listDealers, getDisabledGames } from "@/lib/queries";
import { GAME_KEYS } from "@/lib/games";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

// One list of slugs — lib/games.ts owns the canonical game keys.
const SLUGS: readonly string[] = GAME_KEYS;

export async function generateMetadata({ params }: { params: Promise<{ game: string }> }): Promise<Metadata> {
  const { game } = await params;
  return { title: SLUGS.includes(game as GameSlug) ? game[0].toUpperCase() + game.slice(1) : "Game" };
}

export default async function GamePage({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  if (!SLUGS.includes(game)) notFound();
  const [user, lang, dealers, disabled] = await Promise.all([getCurrentUser(), getLang(), listDealers(), getDisabledGames()]);
  if (!user) redirect("/login");
  // Kill-switch: eject anyone sitting on a disabled game — the page is
  // force-dynamic and LiveRefresher polls it, so an admin flip lands here
  // within a few seconds even mid-session.
  if (disabled.includes(game)) redirect("/games");
  const t = getT(lang);

  return (
    <div className="mx-auto max-w-md px-4 pt-8 pb-10">
      <div className="flex items-center justify-between gap-3">
        <Link href="/games" className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-mute hover:text-ink transition-colors">
          <ArrowLeft className="size-3.5" /> {t.games}
        </Link>
        <SessionChip
          windowStart={user.gameSessionStart?.getTime() ?? null}
          lastPlayAt={user.gameLastPlayAt?.getTime() ?? null}
          playedMs={user.gamePlayedMs}
          lang={lang}
        />
      </div>
      <div className="mt-4">
        <GameView
          game={game as GameSlug}
          balanceCents={user.balanceCents}
          lang={lang}
          dealers={dealers.filter((d) => d.active).map((d) => ({ id: d.id, name: d.name, avatar: d.avatar, quipWin: d.quipWin, quipLose: d.quipLose }))}
          inDebt={accruedDebtCents(user.debtCents, user.debtRateBps, user.debtSince) > 0}
        />
      </div>
      <p className="mt-8 text-[12px] text-faint leading-relaxed">{t.fairNote}</p>
      <LiveRefresher intervalMs={8000} />
    </div>
  );
}
