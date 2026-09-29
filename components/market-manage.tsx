"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleCheck, Ban, Pencil, Lock } from "lucide-react";
import { Button, Card, Input, Textarea, Select } from "@/components/ui/primitives";
import { resolveMarket, cancelMarket, updateMarket } from "@/lib/actions";
import { fmtMarks } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";

// Owner/admin controls on a market page — resolve (this happened / did not
// happen), cancel-and-refund, and an edit form. Question locks once bets
// exist; the server enforces it too.
export function MarketManagePanel({
  market,
  categories,
  betCount,
  lang,
}: {
  market: {
    id: string;
    question: string;
    description: string;
    category: string;
    imageUrl: string | null;
    closesAt: string | Date | null;
    status: string;
    kind: string;
  };
  categories: string[];
  betCount: number;
  lang?: Lang;
}) {
  const t = getT(lang ?? "en");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(market.question);
  const [description, setDescription] = useState(market.description);
  const [category, setCategory] = useState(market.category);
  const [imageUrl, setImageUrl] = useState(market.imageUrl ?? "");
  const [closesAt, setClosesAt] = useState(
    market.closesAt ? new Date(market.closesAt).toISOString().slice(0, 16) : ""
  );
  const [reason, setReason] = useState("");

  const questionLocked = betCount > 0;
  const live = market.status === "live";

  const run = (fn: () => Promise<{ ok: boolean; error?: string; paidOut?: number }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.paidOut ? `${ok} — ${fmtMarks(r.paidOut, { lang })}` : ok);
        router.refresh();
      } else toast.error(r.error);
    });

  return (
    <Card className="p-4 space-y-3">
      <h3 className="text-[13px] font-semibold text-mute uppercase tracking-wide flex items-center gap-1.5">
        <Pencil className="size-3.5" /> {t.manage}
      </h3>

      {live && market.kind !== "group" && (
        <div className="space-y-2">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t.reasonPh}
            maxLength={500}
            className="text-[13px]"
          />
          <div className="flex flex-wrap gap-1.5">
            <Button size="xs" variant="yes" disabled={pending} onClick={() => {
              if (confirm(t.resolveYesConfirm)) run(() => resolveMarket({ marketId: market.id, outcome: "yes", reason }), t.resolvedYesToast);
            }}>
              <CircleCheck className="size-3" /> {t.resolveYes}
            </Button>
            <Button size="xs" variant="no" disabled={pending} onClick={() => {
              if (confirm(t.resolveNoConfirm)) run(() => resolveMarket({ marketId: market.id, outcome: "no", reason }), t.resolvedNoToast);
            }}>
              <CircleCheck className="size-3" /> {t.resolveNo}
            </Button>
            <Button size="xs" variant="outline" disabled={pending} onClick={() => {
              if (confirm(t.cancelConfirm)) run(() => cancelMarket(market.id), t.cancelledToast);
            }}>
              <Ban className="size-3" /> {t.cancelRefund}
            </Button>
          </div>
        </div>
      )}

      <button
        type="button"
        className="text-[12.5px] font-semibold text-brand-strong hover:underline cursor-pointer"
        onClick={() => setEditing((v) => !v)}
      >
        {editing ? "▾" : "▸"} {t.editMarket}
      </button>

      {editing && (
        <form
          className="space-y-2.5 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                updateMarket({
                  marketId: market.id,
                  question,
                  description,
                  category,
                  imageUrl,
                  closesAt: closesAt || undefined,
                }),
              t.savedToast
            );
          }}
        >
          <div>
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={200}
              disabled={questionLocked}
              title={questionLocked ? t.questionLocked : undefined}
            />
            {questionLocked && (
              <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-faint">
                <Lock className="size-3" /> {t.questionLocked}
              </p>
            )}
          </div>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t.rulesPh} className="min-h-20 text-[13px]" />
          <div className="grid grid-cols-2 gap-2">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
            <Input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
          </div>
          <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder={t.imageUrlPh} />
          <Button size="sm" className="w-full" disabled={pending || question.trim().length < 10}>
            {pending ? "…" : t.save}
          </Button>
        </form>
      )}
    </Card>
  );
}
