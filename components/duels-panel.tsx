"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Swords, Check, X, Trophy, AlertTriangle } from "lucide-react";
import { Button, Card, Input, Badge } from "@/components/ui/primitives";
import { createDuel, respondDuel, cancelDuel, proposeDuelWinner } from "@/lib/actions";
import { fmtMarks } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type DuelRow = {
  duel: {
    id: string;
    creatorId: string;
    opponentId: string;
    claim: string;
    stakeCents: number;
    status: string;
    winnerId: string | null;
    pendingWinnerId: string | null;
    pendingById: string | null;
    createdAt: Date;
    settledAt: Date | null;
  };
  creatorName: string | null;
  opponentName: string | null;
  winnerName: string | null;
};

// Head-to-head bets between two users — both stakes escrow on accept, the
// pot pays out when both sides agree on the winner; admins break disputes.
export function DuelsPanel({ duels, me, lang }: { duels: DuelRow[]; me: string; lang?: Lang }) {
  const t = getT(lang ?? "en");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [opp, setOpp] = useState("");
  const [claim, setClaim] = useState("");
  const [stake, setStake] = useState("10");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        if (fn === createDuel) setClaim("");
        router.refresh();
      } else toast.error(r.error);
    });

  const incoming = duels.filter((d) => d.duel.status === "open" && d.duel.opponentId === me);
  const outgoing = duels.filter((d) => d.duel.status === "open" && d.duel.creatorId === me);
  const active = duels.filter((d) => d.duel.status === "accepted" || d.duel.status === "disputed");
  const past = duels.filter((d) => ["settled", "declined", "cancelled"].includes(d.duel.status));

  return (
    <div className="mt-6 space-y-6">
      {/* Create */}
      <Card className="p-5">
        <h2 className="text-[13px] font-semibold text-mute uppercase tracking-wide">{t.duelNew}</h2>
        <div className="mt-3 space-y-2.5">
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <Input
              value={opp}
              onChange={(e) => setOpp(e.target.value)}
              placeholder={t.duelOpponentPh}
              maxLength={40}
            />
            <Input
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              placeholder={t.duelStakePh}
              inputMode="decimal"
            />
          </div>
          <Input
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            placeholder={t.duelClaimPh}
            maxLength={200}
          />
          <Button
            className="w-full"
            disabled={pending || !opp.trim() || claim.trim().length < 5 || !(parseFloat(stake) >= 1)}
            onClick={() =>
              run(
                () => createDuel({ opponent: opp, claim, stakeCents: Math.round(parseFloat(stake || "0") * 100) }),
                t.duelCreatedToast
              )
            }
          >
            <Swords className="size-3.5" /> {t.duelCreate}
          </Button>
          <p className="text-[11.5px] text-faint">{t.duelRulesNote}</p>
        </div>
      </Card>

      {/* Incoming invites */}
      {incoming.length > 0 && (
        <section>
          <h2 className="text-[15px] font-semibold mb-2.5">{t.duelIncoming}</h2>
          <Card className="p-1.5 space-y-1">
            {incoming.map(({ duel: d, creatorName }) => (
              <Row key={d.id} claim={d.claim} sub={`@${creatorName} · ${fmtMarks(d.stakeCents, { lang })} ${t.duelStakeEach}`}>
                <Button size="xs" variant="yes" disabled={pending} onClick={() => run(() => respondDuel({ id: d.id, accept: true }), t.duelAcceptedToast)}>
                  <Check className="size-3" /> {t.duelAccept}
                </Button>
                <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => respondDuel({ id: d.id, accept: false }), t.duelDeclinedToast)}>
                  <X className="size-3" /> {t.duelDecline}
                </Button>
              </Row>
            ))}
          </Card>
        </section>
      )}

      {/* Active */}
      {active.length > 0 && (
        <section>
          <h2 className="text-[15px] font-semibold mb-2.5">{t.duelActive}</h2>
          <Card className="p-1.5 space-y-1">
            {active.map(({ duel: d, creatorName, opponentName }) => {
              const other = d.creatorId === me ? opponentName : creatorName;
              const otherId = d.creatorId === me ? d.opponentId : d.creatorId;
              const awaiting = d.pendingById === me;
              return (
                <Row
                  key={d.id}
                  claim={d.claim}
                  sub={`vs @${other} · ${fmtMarks(d.stakeCents * 2, { lang })} ${t.duelPot}`}
                  badge={
                    d.status === "disputed" ? (
                      <Badge tone="no"><AlertTriangle className="size-3" /> {t.duelDisputed}</Badge>
                    ) : d.pendingWinnerId ? (
                      <Badge tone="warn">{awaiting ? t.duelAwaiting : t.duelConfirmAsk}</Badge>
                    ) : undefined
                  }
                >
                  {!awaiting && (
                    <>
                      <Button size="xs" variant="yes" disabled={pending} onClick={() => run(() => proposeDuelWinner({ id: d.id, winnerId: me }), t.duelVotedToast)}>
                        <Trophy className="size-3" /> {t.duelIWon}
                      </Button>
                      <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => proposeDuelWinner({ id: d.id, winnerId: otherId }), t.duelVotedToast)}>
                        {t.duelTheyWon}
                      </Button>
                    </>
                  )}
                </Row>
              );
            })}
          </Card>
        </section>
      )}

      {/* Outgoing open */}
      {outgoing.length > 0 && (
        <section>
          <h2 className="text-[15px] font-semibold mb-2.5">{t.duelOutgoing}</h2>
          <Card className="p-1.5 space-y-1">
            {outgoing.map(({ duel: d, opponentName }) => (
              <Row key={d.id} claim={d.claim} sub={`→ @${opponentName} · ${fmtMarks(d.stakeCents, { lang })}`}>
                <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => cancelDuel({ id: d.id }), t.duelCancelledToast)}>
                  {t.duelCancel}
                </Button>
              </Row>
            ))}
          </Card>
        </section>
      )}

      {/* History */}
      {past.length > 0 && (
        <section>
          <h2 className="text-[15px] font-semibold mb-2.5">{t.duelHistory}</h2>
          <Card className="p-1.5 space-y-1">
            {past.map(({ duel: d, creatorName, opponentName, winnerName }) => {
              const won = d.status === "settled" && d.winnerId === me;
              const lost = d.status === "settled" && d.winnerId && d.winnerId !== me;
              return (
                <Row
                  key={d.id}
                  claim={d.claim}
                  sub={`@${creatorName} vs @${opponentName}`}
                  badge={
                    d.status === "settled" ? (
                      won ? <Badge tone="yes">+{fmtMarks(d.stakeCents, { lang })}</Badge>
                        : lost ? <Badge tone="no">-{fmtMarks(d.stakeCents, { lang })}</Badge>
                        : <Badge tone="mute">{t.duelRefunded}</Badge>
                    ) : (
                      <Badge tone="mute">{d.status}</Badge>
                    )
                  }
                  dim
                >
                  {won && <Trophy className="size-3.5 text-yes" />}
                  {winnerName && d.status === "settled" && d.winnerId && (
                    <span className="text-[11px] text-faint">@{winnerName}</span>
                  )}
                </Row>
              );
            })}
          </Card>
        </section>
      )}

      {duels.length === 0 && <p className="text-[13px] text-mute text-center py-6">{t.duelEmpty}</p>}
    </div>
  );
}

function Row({
  claim,
  sub,
  badge,
  dim,
  children,
}: {
  claim: string;
  sub: string;
  badge?: React.ReactNode;
  dim?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-3 px-3 py-2.5 rounded-lg", !dim && "bg-surface-2/50")}>
      <div className="flex-1 min-w-0">
        <div className={cn("text-[13px] font-medium leading-snug", dim && "text-mute")}>{claim}</div>
        <div className="text-[11.5px] text-faint mt-0.5">{sub}</div>
      </div>
      {badge}
      <div className="flex items-center gap-1.5 shrink-0">{children}</div>
    </div>
  );
}
