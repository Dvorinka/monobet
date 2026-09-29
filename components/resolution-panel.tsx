"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Scale, CheckCircle2, AlertTriangle, Send } from "lucide-react";
import { Button, Card, Input, Segmented } from "@/components/ui/primitives";
import { proposeResolution, voteResolution } from "@/lib/actions";
import { getT, type Lang } from "@/lib/i18n";

// Community-resolution card: once a market expires anyone may propose an
// outcome; two confirms settle it, disputes hand it to the admins.
export function ResolutionPanel({
  marketId,
  proposedOutcome,
  reason,
  proposer,
  proposedById,
  viewerId,
  confirms,
  disputes,
  myVote,
  lang,
}: {
  marketId: string;
  proposedOutcome: string | null;
  reason: string;
  proposer: string | null;
  proposedById: string | null;
  viewerId: string | undefined;
  confirms: number;
  disputes: number;
  myVote: string | null;
  lang?: Lang;
}) {
  const t = getT(lang ?? "en");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<"yes" | "no">("yes");
  const [r, setR] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(ok);
        router.refresh();
      } else toast.error(res.error);
    });

  const disputed = disputes > 0;

  if (proposedOutcome) {
    const isProposer = !!viewerId && viewerId === proposedById;
    return (
      <Card className={`p-4 border ${disputed ? "border-no/40" : "border-amber-500/40"}`}>
        <h3 className="text-[13px] font-semibold flex items-center gap-1.5">
          <Scale className="size-3.5" />
          {t.proposalHeading((proposedOutcome === "yes" ? t.yes : t.no).toUpperCase())}
        </h3>
        <p className="text-[12.5px] text-mute mt-1">
          {t.proposedBy(proposer ?? "?")}
          {reason ? ` — ${reason}` : ""}
        </p>
        <p className="text-[11.5px] text-faint mt-1.5">
          {t.voteTally(confirms, disputes)}
          {disputed && ` · ${t.disputedNote}`}
        </p>
        {viewerId && !isProposer && (
          <div className="flex gap-1.5 mt-3">
            <Button
              size="xs"
              variant={myVote === "confirm" ? "yes" : "outline"}
              disabled={pending}
              onClick={() => run(() => voteResolution({ marketId, vote: "confirm" }), t.votedToast)}
            >
              <CheckCircle2 className="size-3" /> {t.confirmVote}
            </Button>
            <Button
              size="xs"
              variant={myVote === "dispute" ? "no" : "outline"}
              disabled={pending}
              onClick={() => run(() => voteResolution({ marketId, vote: "dispute" }), t.votedToast)}
            >
              <AlertTriangle className="size-3" /> {t.disputeVote}
            </Button>
          </div>
        )}
      </Card>
    );
  }

  if (!viewerId) return null;
  return (
    <Card className="p-4">
      <h3 className="text-[13px] font-semibold flex items-center gap-1.5">
        <Scale className="size-3.5" /> {t.proposeOutcomeTitle}
      </h3>
      <p className="text-[11.5px] text-mute mt-1">{t.proposeHint}</p>
      <div className="mt-2.5">
        <Segmented
          value={outcome}
          onChange={(v) => setOutcome(v as "yes" | "no")}
          options={[
            { value: "yes", label: t.yes },
            { value: "no", label: t.no },
          ]}
        />
      </div>
      <div className="flex gap-1.5 mt-2.5">
        <Input
          value={r}
          onChange={(e) => setR(e.target.value)}
          placeholder={t.reasonPh}
          maxLength={500}
          className="text-[13px]"
        />
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(() => proposeResolution({ marketId, outcome, reason: r }), t.proposedToast)}
        >
          <Send className="size-3" /> {t.propose}
        </Button>
      </div>
    </Card>
  );
}
