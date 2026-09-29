"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleCheck, Ban, Pencil, Lock, ChevronDown, ChevronRight } from "lucide-react";
import { Button, Card, Input, Textarea, Select } from "@/components/ui/primitives";
import { ImageCell, IconPicker } from "@/components/image-cell";
import { MarketIcon } from "@/components/market-icon";
import { resolveMarket, cancelMarket, updateMarket } from "@/lib/actions";
import { fmtMonos } from "@/lib/money";
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
    context?: string;
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
  const [context, setContext] = useState(market.context ?? "");
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
        toast.success(r.paidOut ? `${ok} — ${fmtMonos(r.paidOut, { lang })}` : ok);
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
        className="flex w-full items-center justify-between rounded-lg border border-line-2 bg-surface-2/50 px-3 py-2 text-[12.5px] font-semibold text-ink hover:bg-surface-2 transition-colors cursor-pointer"
        onClick={() => setEditing((v) => !v)}
      >
        <span className="inline-flex items-center gap-1.5">
          <Pencil className="size-3.5 text-faint" /> {t.editMarket}
        </span>
        {editing ? <ChevronDown className="size-4 text-faint" /> : <ChevronRight className="size-4 text-faint" />}
      </button>

      {editing && (
        <form
          className="space-y-3 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                updateMarket({
                  marketId: market.id,
                  question,
                  description,
                  context,
                  category,
                  imageUrl,
                  closesAt: closesAt || undefined,
                }),
              t.savedToast
            );
          }}
        >
          {/* Live preview — icon + question exactly as cards render them. */}
          <div className="rounded-xl border border-line-2 bg-surface-2/40 p-2.5">
            <div className="flex items-center gap-2.5">
              <MarketIcon market={{ question, category, imageUrl: imageUrl || null }} size="size-10" />
              <span className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug line-clamp-2 text-ink-2">
                {question || "…"}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <ImageCell
                image={imageUrl}
                onImage={setImageUrl}
                imageHint={t.optionImageHint}
                onBadImage={() => toast.error(t.imageBad)}
                className="size-9"
              />
              <IconPicker onPick={setImageUrl} hint={t.iconPickerHint} />
              <p className="min-w-0 flex-1 text-[10.5px] leading-tight text-faint">{t.marketIconHint}</p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">
              {t.question}
            </label>
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

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">
              {t.rules}
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.rulesPh}
              className="min-h-24 text-[13px]"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">
              {t.marketContext}
            </label>
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder={t.contextPh}
              maxLength={2000}
              className="min-h-16 text-[13px]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">
                {t.category}
              </label>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">
                {t.closes}
              </label>
              <Input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
            </div>
          </div>

          <Button size="sm" className="w-full" disabled={pending || question.trim().length < 10}>
            {pending ? "…" : t.save}
          </Button>
        </form>
      )}
    </Card>
  );
}
