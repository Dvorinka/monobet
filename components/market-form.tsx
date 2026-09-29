"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Input, Select, Textarea, Card, Segmented } from "@/components/ui/primitives";
import { proposeMarket } from "@/lib/actions";
import { getT, type Lang } from "@/lib/i18n";
import { optionColor } from "@/lib/option-style";
import { cn } from "@/lib/utils";

const NEW_CATEGORY = "__new__";

export function MarketForm({
  isAdmin,
  categories,
  lang,
}: {
  isAdmin: boolean;
  categories: string[];
  lang?: Lang;
}) {
  const t = getT(lang ?? "en");
  const LIQUIDITY = [
    { b: 100, label: t.liqThin, hint: t.liqThinHint },
    { b: 300, label: t.liqStandard, hint: t.liqStandardHint },
    { b: 900, label: t.liqDeep, hint: t.liqDeepHint },
  ] as const;
  const [marketType, setMarketType] = useState<"binary" | "multi">("binary");
  const [question, setQuestion] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>(categories[0] ?? NEW_CATEGORY);
  const [newCategory, setNewCategory] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [recurDays, setRecurDays] = useState("0");
  const [odds, setOdds] = useState(50);
  const [optionOdds, setOptionOdds] = useState<Record<number, number>>({});
  const [liquidity, setLiquidity] = useState<number>(300);
  const [pending, start] = useTransition();
  const router = useRouter();

  const optionLines = optionsText.split("\n").map((o) => o.trim()).filter(Boolean);
  // Display label is the part before the optional "| image-url".
  const optionLabels = optionLines.map((l) => l.split("|")[0].trim());
  const multi = marketType === "multi";
  // Multi-option odds default to a uniform split — e.g. ~17% for 6 options.
  const uniformOdds = optionLines.length > 0 ? Math.max(1, Math.min(99, Math.round(100 / optionLines.length))) : 50;
  const probFor = (i: number) => optionOdds[i] ?? uniformOdds;

  return (
    <Card className="p-6">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await proposeMarket({
              question,
              description,
              category,
              newCategory: category === NEW_CATEGORY ? newCategory : undefined,
              closesAt: closesAt || undefined,
              initialProb: odds / 100,
              liquidity,
              outcomes: multi ? optionLines : undefined,
              optionProbs: multi ? optionLines.map((_, i) => probFor(i)) : undefined,
              recurDays: multi ? undefined : Number(recurDays),
            });
            if (r.ok) {
              toast.success(t.live);
              router.push(`/market/${r.slug}`);
            } else toast.error(r.error);
          });
        }}
      >
        <div>
          <label className="text-[13px] font-medium text-mute">{t.marketType}</label>
          <Segmented
            className="mt-1.5 w-full"
            options={[
              { value: "binary", label: t.typeBinary },
              { value: "multi", label: t.typeMulti },
            ]}
            value={marketType}
            onChange={(v) => setMarketType(v as "binary" | "multi")}
          />
          <p className="mt-1.5 text-[11.5px] text-faint">
            {multi ? t.multiHint : t.binaryHint}
          </p>
        </div>

        <div>
          <label className="text-[13px] font-medium text-mute" htmlFor="q">
            {t.question}
          </label>
          <Input
            id="q"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={multi ? t.qPhMulti : t.qPhBinary}
            maxLength={200}
            className="mt-1"
            required
          />
          <p className="mt-1 text-[11.5px] text-faint">
            {multi ? t.qHintMulti : t.qHintBinary} {t.charsLeft(200 - question.length)}
          </p>
        </div>

        {multi && (
          <div>
            <label className="text-[13px] font-medium text-mute" htmlFor="opts">
              {t.optionsLabel}
            </label>
            <Textarea
              id="opts"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder={t.optionsPh}
              className="mt-1 min-h-24 font-mono text-[13px]"
              required
            />
            <p className="mt-1 text-[11.5px] text-faint">{t.optionsHint(optionLines.length)}</p>
          </div>
        )}

        <div>
          <label className="text-[13px] font-medium text-mute" htmlFor="d">
            {t.resolutionRules}
          </label>
          <Textarea
            id="d"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.rulesPh}
            maxLength={5000}
            className="mt-1 min-h-28"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[13px] font-medium text-mute" htmlFor="c">
              {t.category}
            </label>
            <Select id="c" value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1">
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value={NEW_CATEGORY}>{t.newCategory}</option>
            </Select>
            {category === NEW_CATEGORY && (
              <Input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder={t.newCategoryPh}
                maxLength={24}
                className="mt-2"
                required
                autoFocus
              />
            )}
          </div>
          <div>
            <label className="text-[13px] font-medium text-mute" htmlFor="t">
              {t.bettingCloses}
            </label>
            <Input
              id="t"
              type="datetime-local"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              className="mt-1"
              lang={lang}
            />
          </div>
        </div>

        {!multi && closesAt && (
          <div>
            <label className="text-[13px] font-medium text-mute" htmlFor="recur">
              {t.repeats}
            </label>
            <Select id="recur" value={recurDays} onChange={(e) => setRecurDays(e.target.value)} className="mt-1">
              <option value="0">{t.recurNever}</option>
              <option value="7">{t.recurWeekly}</option>
              <option value="14">{t.recurBiweekly}</option>
              <option value="30">{t.recurMonthly}</option>
            </Select>
            <p className="mt-1 text-[11.5px] text-faint">{t.repeatsHint}</p>
          </div>
        )}

        {multi ? (
          <div>
            <label className="text-[13px] font-medium text-mute">{t.startingOdds}</label>
            <div className="mt-2 space-y-2.5 rounded-lg border border-line p-3">
              {optionLines.length === 0 && (
                <p className="text-[12px] text-faint">{t.optionsHint(0)}</p>
              )}
              {optionLines.map((line, i) => {
                const v = probFor(i);
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span
                      className="size-2.5 rounded-full shrink-0"
                      style={{ background: optionColor(i) }}
                    />
                    <span className="flex-1 min-w-0 text-[13px] font-medium truncate" title={optionLabels[i]}>
                      {optionLabels[i] || line}
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={99}
                      value={v}
                      onChange={(e) => setOptionOdds((s) => ({ ...s, [i]: Number(e.target.value) }))}
                      className="w-28 sm:w-36 accent-brand cursor-pointer shrink-0"
                      aria-label={`${optionLabels[i]} ${t.startingOdds}`}
                    />
                    <span className="num w-9 text-right text-[12.5px] font-bold shrink-0" style={{ color: optionColor(i) }}>
                      {v}%
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-[11.5px] text-faint">{t.perOptionOdds}</p>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between">
              <label className="text-[13px] font-medium text-mute" htmlFor="odds">
                {t.startingOdds}
              </label>
              <span className="num text-[13px] font-bold text-ink">{odds}%</span>
            </div>
            <div className="mt-2 flex h-9 overflow-hidden rounded-lg border border-line">
              <div
                className="grid place-items-center bg-yes-soft text-yes-strong text-[12.5px] font-bold transition-all duration-150"
                style={{ width: `${odds}%` }}
              >
                {odds >= 14 && `${t.yes} ${odds}%`}
              </div>
              <div className="grid flex-1 place-items-center bg-no-soft text-no-strong text-[12.5px] font-bold">
                {odds <= 86 && `${t.no} ${100 - odds}%`}
              </div>
            </div>
            <input
              id="odds"
              type="range"
              min={3}
              max={97}
              value={odds}
              onChange={(e) => setOdds(Number(e.target.value))}
              className="mt-2 w-full accent-brand cursor-pointer"
            />
            <p className="text-[11.5px] text-faint">{t.oddsHint(false)}</p>
          </div>
        )}

        <div>
          <label className="text-[13px] font-medium text-mute">{t.liquidity}</label>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {LIQUIDITY.map((l) => (
              <button
                key={l.b}
                type="button"
                onClick={() => setLiquidity(l.b)}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left cursor-pointer transition-colors",
                  liquidity === l.b
                    ? "border-brand bg-brand-soft"
                    : "border-line hover:border-faint/60"
                )}
              >
                <div className="text-[13px] font-bold">{l.label}</div>
                <div className="mt-0.5 text-[11px] leading-tight text-mute">{l.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <Button className="w-full" size="lg" disabled={pending}>
          {pending ? t.creating : t.createMarket}
        </Button>

        <p className="text-[12px] text-faint text-center">
          {isAdmin ? t.formNoteAdmin : t.formNoteUser}
        </p>
      </form>
    </Card>
  );
}
