import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { GameView, type GameSlug } from "@/components/games-panel";
import { listDealers } from "@/lib/queries";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

const SLUGS = ["coinflip", "dice", "timer", "limbo", "wheel", "slots", "blackjack"] as const;

export async function generateMetadata({ params }: { params: Promise<{ game: string }> }): Promise<Metadata> {
  const { game } = await params;
  return { title: SLUGS.includes(game as GameSlug) ? game[0].toUpperCase() + game.slice(1) : "Game" };
}

export default async function GamePage({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  if (!SLUGS.includes(game as GameSlug)) notFound();
  const [user, lang, dealers] = await Promise.all([getCurrentUser(), getLang(), listDealers()]);
  if (!user) redirect("/login");
  const t = getT(lang);

  return (
    <div className="mx-auto max-w-md px-4 pt-8 pb-10">
      <Link href="/games" className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-mute hover:text-ink transition-colors">
        <ArrowLeft className="size-3.5" /> {t.games}
      </Link>
      <div className="mt-4">
        <GameView
          game={game as GameSlug}
          balanceCents={user.balanceCents}
          lang={lang}
          dealers={dealers.filter((d) => d.active).map((d) => ({ id: d.id, name: d.name, avatar: d.avatar, quipWin: d.quipWin, quipLose: d.quipLose }))}
        />
      </div>
      <p className="mt-8 text-[12px] text-faint leading-relaxed">{t.fairNote}</p>
    </div>
  );
}
