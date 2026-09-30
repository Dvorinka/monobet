"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Swords, Check, X, Trophy, AlertTriangle, Dices, RefreshCw, CircleDot, Clover } from "lucide-react";
import { Button, Card, Input, Badge, Select, Segmented } from "@/components/ui/primitives";
import { createDuel, respondDuel, cancelDuel, proposeDuelWinner, duelPlay } from "@/lib/actions";
import { fmtMonos } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { DuelKind } from "@/lib/games";

type DuelState = { moves?: Record<string, string | number> } | null;

type DuelRow = {
  duel: {
    id: string;
    creatorId: string;
    opponentId: string;
    claim: string;
    stakeCents: number;
    kind: string;
    state: unknown;
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

type Opponent = { id: string; username: string | null; name: string; image: string | null };

const KIND_ICONS: Record<string, React.ReactNode> = {
  claim: <Swords className="size-3.5" />,
  rps: <Clover className="size-3.5" />,
  roll: <Dices className="size-3.5" />,
  wheel: <CircleDot className="size-3.5" />,
  slots: <RefreshCw className="size-3.5" />,
};

// Head-to-head bets between two users — both stakes escrow on accept, the
// pot pays out when both sides agree on the winner; admins break disputes.
// Game kinds (rps/roll/wheel/slots) resolve themselves server-side.
export function DuelsPanel({
  duels,
  me,
  opponents,
  balanceCents,
  lang,
}: {
  duels: DuelRow[];
  me: string;
  opponents: Opponent[];
  balanceCents: number;
  lang?: Lang;
}) {
  const t = getT(lang ?? "en");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [opp, setOpp] = useState("");
  const [kind, setKind] = useState<DuelKind>("claim");
  const [claim, setClaim] = useState("");
  const [stake, setStake] = useState("10");

  const kindLabels: Record<DuelKind, string> = {
    claim: t.duelKindClaim,
    rps: t.duelKindRps,
    roll: t.duelKindRoll,
    wheel: t.duelKindWheel,
    slots: t.duelKindSlots,
  };
  const kindDesc: Record<DuelKind, string> = {
    claim: t.duelKindClaimDesc,
    rps: t.duelKindRpsDesc,
    roll: t.duelKindRollDesc,
    wheel: t.duelKindWheelDesc,
    slots: t.duelKindSlotsDesc,
  };
  const moveLabel = (mv: string | number | undefined) => {
    if (mv === undefined) return "—";
    if (mv === "rock") return t.duelMoveRock;
    if (mv === "paper") return t.duelMovePaper;
    if (mv === "scissors") return t.duelMoveScissors;
    if (typeof mv === "number") return mv > 1 ? `×${mv}` : `${mv}`;
    return String(mv);
  };
  // Wheel/slots values are multipliers, roll is a raw die face.
  const fmtMove = (k: string, mv: string | number | undefined) =>
    mv === undefined ? "—" : k === "rps" ? moveLabel(mv) : k === "roll" ? `${mv}` : `×${mv}`;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, onOk?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        onOk?.();
        router.refresh();
      } else toast.error(r.error);
    });

  const play = (id: string, move?: string) =>
    start(async () => {
      const r = await duelPlay({ id, move });
      if (!r.ok) toast.error(r.error);
      else if (r.tie) toast(t.duelTieToast);
      else if (r.waiting) toast.success(t.duelMoveLockedToast);
      router.refresh();
    });

  const stakeCents = Math.round(parseFloat(stake || "0") * 100);
  const duelTitle = (d: DuelRow["duel"]) => (d.kind === "claim" ? d.claim : kindLabels[d.kind as DuelKind] ?? d.claim);

  const incoming = duels.filter((d) => d.duel.status === "open" && d.duel.opponentId === me);
  const outgoing = duels.filter((d) => d.duel.status === "open" && d.duel.creatorId === me);
  const active = duels.filter((d) => d.duel.status === "accepted" || d.duel.status === "disputed");
  const past = duels.filter((d) => ["settled", "declined", "cancelled"].includes(d.duel.status));

  return (
    <div className="mt-6 space-y-6">
      {/* Create */}
      <Card className="p-5">
        <h2 className="text-[13px] font-semibold text-mute uppercase tracking-wide">{t.duelNew}</h2>
        <div className="mt-3 space-y-3">
          <div>
            <div className="text-[11.5px] font-semibold text-mute mb-1.5">{t.duelGameType}</div>
            <Segmented
              value={kind}
              onChange={(v) => setKind(v)}
              options={(Object.keys(kindLabels) as DuelKind[]).map((k) => ({ value: k, label: kindLabels[k] }))}
            />
            <p className="text-[11.5px] text-faint mt-1.5">{kindDesc[kind]}</p>
          </div>
          <div className="grid grid-cols-[1fr_130px] gap-2.5">
            <div>
              <div className="text-[11.5px] font-semibold text-mute mb-1.5">{t.duelOpponentLabel}</div>
              <Select value={opp} onChange={(e) => setOpp(e.target.value)}>
                <option value="">{t.duelPickOpp}</option>
                {opponents.map((o) => (
                  <option key={o.id} value={o.username ?? ""}>
                    @{o.username ?? o.name}
                    {o.name && o.username && o.name !== o.username ? ` — ${o.name}` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <div className="text-[11.5px] font-semibold text-mute mb-1.5">{t.duelStakeLabel}</div>
              <Input
                value={stake}
                onChange={(e) => setStake(e.target.value)}
                placeholder="Ɱ 10"
                inputMode="decimal"
              />
            </div>
          </div>
          <p className="text-[11.5px] text-faint -mt-1">
            {t.duelStakeExplain}{" "}
            {stakeCents >= 100 && (
              <span className="text-ink font-semibold">{t.duelPotPreview(fmtMonos(stakeCents * 2, { lang }))}</span>
            )}
          </p>
          {kind === "claim" && (
            <Input
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              placeholder={t.duelClaimPh}
              maxLength={200}
            />
          )}
          <Button
            className="w-full"
            disabled={pending || !opp || stakeCents < 100 || stakeCents > balanceCents || (kind === "claim" && claim.trim().length < 5)}
            onClick={() =>
              run(
                () => createDuel({ opponent: opp, claim, stakeCents, kind }),
                t.duelCreatedToast,
                () => { setClaim(""); setOpp(""); }
              )
            }
          >
            <Swords className="size-3.5" /> {t.duelCreate}
          </Button>
          <p className="text-[11.5px] text-faint">{kind === "claim" ? t.duelRulesNote : t.duelFreeNote}</p>
        </div>
      </Card>

      {/* Incoming invites */}
      {incoming.length > 0 && (
        <section>
          <h2 className="text-[15px] font-semibold mb-2.5">{t.duelIncoming}</h2>
          <Card className="p-1.5 space-y-1">
            {incoming.map(({ duel: d, creatorName }) => (
              <Row key={d.id} claim={duelTitle(d)} kind={d.kind} sub={`@${creatorName} · ${fmtMonos(d.stakeCents, { lang })} ${t.duelStakeEach}`}>
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
              const moves = ((d.state as DuelState)?.moves) ?? {};
              const myMove = moves[me];
              const game = d.kind !== "claim";
              return (
                <Row
                  key={d.id}
                  claim={duelTitle(d)}
                  kind={d.kind}
                  sub={`vs @${other} · ${fmtMonos(d.stakeCents * 2, { lang })} ${t.duelPot}`}
                  badge={
                    d.status === "disputed" ? (
                      <Badge tone="no"><AlertTriangle className="size-3" /> {t.duelDisputed}</Badge>
                    ) : d.pendingWinnerId ? (
                      <Badge tone="warn">{awaiting ? t.duelAwaiting : t.duelConfirmAsk}</Badge>
                    ) : undefined
                  }
                >
                  {game ? (
                    myMove !== undefined ? (
                      <span className="text-[11.5px] text-mute">
                        {t.duelYourMove(fmtMove(d.kind, myMove))} · {t.duelWaitMove}
                      </span>
                    ) : d.kind === "rps" ? (
                      <>
                        {(["rock", "paper", "scissors"] as const).map((m) => (
                          <Button key={m} size="xs" variant="outline" disabled={pending} onClick={() => play(d.id, m)}>
                            {moveLabel(m)}
                          </Button>
                        ))}
                      </>
                    ) : (
                      <Button size="xs" variant="yes" disabled={pending} onClick={() => play(d.id)}>
                        {KIND_ICONS[d.kind]} {d.kind === "roll" ? t.duelRollBtn : d.kind === "wheel" ? t.duelSpinBtn : t.duelDrawBtn}
                      </Button>
                    )
                  ) : (
                    !awaiting && (
                      <>
                        <Button size="xs" variant="yes" disabled={pending} onClick={() => run(() => proposeDuelWinner({ id: d.id, winnerId: me }), t.duelVotedToast)}>
                          <Trophy className="size-3" /> {t.duelIWon}
                        </Button>
                        <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => proposeDuelWinner({ id: d.id, winnerId: otherId }), t.duelVotedToast)}>
                          {t.duelTheyWon}
                        </Button>
                      </>
                    )
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
              <Row key={d.id} claim={duelTitle(d)} kind={d.kind} sub={`→ @${opponentName} · ${fmtMonos(d.stakeCents, { lang })}`}>
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
              const moves = ((d.state as DuelState)?.moves) ?? {};
              const hasMoves = Object.keys(moves).length === 2;
              return (
                <Row
                  key={d.id}
                  claim={duelTitle(d)}
                  kind={d.kind}
                  sub={`@${creatorName} vs @${opponentName}${hasMoves ? ` · ${fmtMove(d.kind, moves[d.creatorId])} vs ${fmtMove(d.kind, moves[d.opponentId])}` : ""}`}
                  badge={
                    d.status === "settled" ? (
                      won ? <Badge tone="yes">+{fmtMonos(d.stakeCents, { lang })}</Badge>
                        : lost ? <Badge tone="no">-{fmtMonos(d.stakeCents, { lang })}</Badge>
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
  kind,
  sub,
  badge,
  dim,
  children,
}: {
  claim: string;
  kind?: string;
  sub: string;
  badge?: React.ReactNode;
  dim?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-3 px-3 py-2.5 rounded-lg", !dim && "bg-surface-2/50")}>
      {kind && kind !== "claim" && (
        <span className="size-7 rounded-md bg-brand-soft text-brand-strong flex items-center justify-center shrink-0">
          {KIND_ICONS[kind]}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className={cn("text-[13px] font-medium leading-snug", dim && "text-mute")}>{claim}</div>
        <div className="text-[11.5px] text-faint mt-0.5">{sub}</div>
      </div>
      {badge}
      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">{children}</div>
    </div>
  );
}
