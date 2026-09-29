"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Input, Select, Textarea, Card, Segmented } from "@/components/ui/primitives";
import { proposeMarket } from "@/lib/actions";
import { getT, type Lang } from "@/lib/i18n";
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
  const [category, setCategory] = useState<string>(categories.includes("Friends") ? "Friends" : (categories[0] ?? ""));
  const [newCategory, setNewCategory] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [odds, setOdds] = useState(50);
  const [liquidity, setLiquidity] = useState<number>(300);
  const [pending, start] = useTransition();
  const router = useRouter();

  const optionLines = optionsText.split("\n").map((o) => o.trim()).filter(Boolean);
  const multi = marketType === "multi";

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
          <p className="text-[11.5px] text-faint">{t.oddsHint(multi)}</p>
        </div>

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
