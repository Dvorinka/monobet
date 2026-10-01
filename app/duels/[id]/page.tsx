import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getDuel } from "@/lib/queries";
import { hideDuelMoves } from "@/lib/games";
import { getLang } from "@/lib/lang-server";
import { DuelArena } from "@/components/duel-arena";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Duel" };

export default async function DuelPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, lang, { id }] = await Promise.all([getCurrentUser(), getLang(), params]);
  if (!user) redirect("/login");
  const row = await getDuel(user.id, id);
  if (!row) notFound();
  // Hide the opponent's move until the duel settles — peeks would leak picks.
  row.duel.state = hideDuelMoves(row.duel.state, user.id, row.duel.status === "settled");
  return <DuelArena row={row} me={user.id} lang={lang} />;
}
