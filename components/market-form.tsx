"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Input, Select, Textarea, Card, Segmented } from "@/components/ui/primitives";
import { proposeMarket } from "@/lib/actions";
import { compressImage } from "@/components/comments";
import { getT, type Lang } from "@/lib/i18n";
import { optionColor } from "@/lib/option-style";
import { cn } from "@/lib/utils";
import { ImagePlus, Plus, X, Shapes, TrendingUp, Trophy, Coins, Zap, Globe, Flag, Star, Heart, Users, Gamepad2, Music, Plane, Car, Home, Cpu, Film, Landmark, Rocket, CalendarDays, Target } from "lucide-react";

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
  const [marketType, setMarketType] = useState<"binary" | "multi" | "range">("binary");
  const [question, setQuestion] = useState("");
  const [marketImage, setMarketImage] = useState("");
  const [options, setOptions] = useState<{ label: string; image: string }[]>([
    { label: "", image: "" },
    { label: "", image: "" },
  ]);
  const [rangeMin, setRangeMin] = useState("0");
  const [rangeMax, setRangeMax] = useState("100");
  const [rangeStep, setRangeStep] = useState("10");
  const [rangeCustom, setRangeCustom] = useState(false);
  const [rangeText, setRangeText] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>(categories[0] ?? NEW_CATEGORY);
  const [newCategory, setNewCategory] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [recurDays, setRecurDays] = useState("0");
  const [odds, setOdds] = useState(50);
  const [optionOdds, setOptionOdds] = useState<Record<number, number>>({});
  const [liquidity, setLiquidity] = useState<number>(300);
  const [maxLeverage, setMaxLeverage] = useState(10);
  const [pending, start] = useTransition();
  const router = useRouter();

  // Range markets are group markets whose options are generated numeric
  // buckets — same AMM and resolution path, just a label convention.
  const rangeLo = parseFloat(rangeMin);
  const rangeHi = parseFloat(rangeMax);
  const rangeSt = parseFloat(rangeStep);
  const rangeBuckets = useMemo(() => {
    if (marketType !== "range" || !Number.isFinite(rangeLo) || !Number.isFinite(rangeHi) || !Number.isFinite(rangeSt))
      return [] as string[];
    if (rangeSt <= 0 || rangeHi <= rangeLo) return [] as string[];
    const n = Math.ceil((rangeHi - rangeLo) / rangeSt);
    if (n < 2 || n > 12) return [] as string[];
    const fmt = (x: number) => String(Math.round(x * 100) / 100);
    return Array.from({ length: n }, (_, i) => {
      const lo = rangeLo + i * rangeSt;
      const hi = Math.min(rangeHi, lo + rangeSt);
      return `${fmt(lo)} – ${fmt(hi)}`;
    });
  }, [marketType, rangeLo, rangeHi, rangeSt]);

  const rangeLines = rangeText.split("\n").map((o) => o.trim()).filter(Boolean);
  // Options are structured rows — server accepts "label | image-url" lines.
  const optionRows = options.filter((o) => o.label.trim());
  const optionLines =
    marketType === "range"
      ? rangeCustom
        ? rangeLines
        : rangeBuckets
      : optionRows.map((o) => (o.image ? `${o.label.trim()} | ${o.image}` : o.label.trim()));
  // Display label is the part before the optional "| image-url".
  const optionLabels = optionLines.map((l) => l.split("|")[0].trim());
  const multi = marketType !== "binary";
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
              imageUrl: marketImage || undefined,
              category,
              newCategory: category === NEW_CATEGORY ? newCategory : undefined,
              closesAt: closesAt || undefined,
              initialProb: odds / 100,
              liquidity,
              outcomes: multi ? optionLines : undefined, // range buckets arrive as ordinary options
              optionProbs: multi ? optionLines.map((_, i) => probFor(i)) : undefined,
              recurDays: multi ? undefined : Number(recurDays),
              maxLeverage,
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
              { value: "range", label: t.typeRange },
            ]}
            value={marketType}
            onChange={(v) => setMarketType(v as "binary" | "multi" | "range")}
          />
          <p className="mt-1.5 text-[11.5px] text-faint">
            {marketType === "range" ? t.rangeHint : multi ? t.multiHint : t.binaryHint}
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
          <div className="mt-2 flex items-center gap-2">
            <ImageCell
              image={marketImage}
              onImage={setMarketImage}
              imageHint={t.optionImageHint}
              onBadImage={() => toast.error(t.imageBad)}
              className="size-10"
            />
            <IconPicker onPick={setMarketImage} hint={t.iconPickerHint} />
            <p className="text-[11.5px] text-faint">{t.marketIconHint}</p>
          </div>
        </div>

        {marketType === "range" && (
          <div>
            <div className="flex items-center justify-between">
              <label className="text-[13px] font-medium text-mute">{t.rangeBounds}</label>
              <button
                type="button"
                onClick={() => {
                  if (!rangeCustom) setRangeText(rangeBuckets.join("\n"));
                  setRangeCustom(!rangeCustom);
                }}
                className="text-[12px] font-semibold text-brand hover:text-brand-strong cursor-pointer"
              >
                {rangeCustom ? t.rangeAuto : t.rangeEdit}
              </button>
            </div>
            {!rangeCustom && (
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                <Input value={rangeMin} onChange={(e) => setRangeMin(e.target.value)} placeholder={t.rangeMin} inputMode="decimal" />
                <Input value={rangeMax} onChange={(e) => setRangeMax(e.target.value)} placeholder={t.rangeMax} inputMode="decimal" />
                <Input value={rangeStep} onChange={(e) => setRangeStep(e.target.value)} placeholder={t.rangeStep} inputMode="decimal" />
              </div>
            )}
            {rangeCustom ? (
              <Textarea
                value={rangeText}
                onChange={(e) => setRangeText(e.target.value)}
                placeholder={t.rangeCustomPh}
                className="mt-1.5 min-h-28 font-mono text-[13px]"
              />
            ) : (
              <p className="mt-1 text-[11.5px] text-faint">
                {rangeBuckets.length >= 2
                  ? t.rangePreview(rangeBuckets.length)
                  : t.rangeInvalid}
              </p>
            )}
            {optionLines.length >= 2 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {optionLines.map((b, i) => (
                  <span key={i} className="rounded-md bg-surface-2 px-2 py-1 text-[11.5px] font-semibold text-mute">{optionLabels[i] || b}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {marketType === "multi" && (
          <div>
            <label className="text-[13px] font-medium text-mute">{t.optionsLabel}</label>
            <div className="mt-1.5 space-y-1.5">
              {options.map((o, i) => (
                <OptionRow
                  key={i}
                  index={i}
                  label={o.label}
                  image={o.image}
                  placeholder={t.optionPh(i + 1)}
                  canRemove={options.length > 2}
                  onLabel={(v) => setOptions((s) => s.map((r, j) => (j === i ? { ...r, label: v } : r)))}
                  onPasteList={(lines) =>
                    setOptions((s) => {
                      const next = [...s];
                      lines.forEach((l, k) => {
                        const j = i + k;
                        if (j < next.length) next[j] = { ...next[j], label: l.slice(0, 60) };
                        else if (next.length < 12) next.push({ label: l.slice(0, 60), image: "" });
                      });
                      return next;
                    })
                  }
                  onImage={(v) => setOptions((s) => s.map((r, j) => (j === i ? { ...r, image: v } : r)))}
                  onRemove={() => setOptions((s) => s.filter((_, j) => j !== i))}
                  imageHint={t.optionImageHint}
                  onBadImage={() => toast.error(t.imageBad)}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[11.5px] text-faint">{t.optionsHint(optionRows.length)}</p>
              {options.length < 12 && (
                <button
                  type="button"
                  onClick={() => setOptions((s) => [...s, { label: "", image: "" }])}
                  className="flex items-center gap-1 text-[12px] font-semibold text-brand hover:text-brand-strong cursor-pointer"
                >
                  <Plus className="size-3.5" /> {t.addOption}
                </button>
              )}
            </div>
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
                    <div className="relative shrink-0">
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={v}
                        onChange={(e) => {
                          const n = Math.round(Number(e.target.value));
                          if (e.target.value !== "" && Number.isFinite(n))
                            setOptionOdds((s) => ({ ...s, [i]: Math.min(99, Math.max(1, n)) }));
                        }}
                        className="num w-14 rounded-md border border-line bg-surface py-1 pl-1.5 pr-4 text-right text-[12.5px] font-bold focus:outline-2 focus:outline-brand"
                        style={{ color: optionColor(i) }}
                        aria-label={`${optionLabels[i]} odds %`}
                      />
                      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] text-faint">%</span>
                    </div>
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
              <div className="relative">
                <input
                  type="number"
                  min={3}
                  max={97}
                  value={odds}
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value));
                    if (e.target.value !== "" && Number.isFinite(n))
                      setOdds(Math.min(97, Math.max(3, n)));
                  }}
                  className="num w-16 rounded-md border border-line bg-surface py-1 pl-2 pr-5 text-right text-[13px] font-bold text-ink focus:outline-2 focus:outline-brand"
                  aria-label={`${t.startingOdds} %`}
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-faint">%</span>
              </div>
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
          <label className="text-[13px] font-medium text-mute" htmlFor="maxlev">
            {t.maxLev}
          </label>
          <Select id="maxlev" value={String(maxLeverage)} onChange={(e) => setMaxLeverage(Number(e.target.value))} className="mt-1">
            {[1, 2, 3, 5, 10].map((v) => (
              <option key={v} value={v}>
                {v === 1 ? `${t.maxLevNone} (1×)` : `${v}×`}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[11.5px] text-faint">{t.maxLevHint}</p>
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

// One option row: label input + image cell + remove. Pasting a multi-line
// value into the label spills the lines into following rows.
function OptionRow({
  index,
  label,
  image,
  placeholder,
  canRemove,
  onLabel,
  onPasteList,
  onImage,
  onRemove,
  imageHint,
  onBadImage,
}: {
  index: number;
  label: string;
  image: string;
  placeholder: string;
  canRemove: boolean;
  onLabel: (v: string) => void;
  onPasteList: (lines: string[]) => void;
  onImage: (v: string) => void;
  onRemove: () => void;
  imageHint: string;
  onBadImage: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-full shrink-0" style={{ background: optionColor(index) }} />
      <Input
        value={label}
        onChange={(e) => onLabel(e.target.value)}
        onPaste={(e) => {
          const txt = e.clipboardData?.getData("text") ?? "";
          if (!txt.includes("\n")) return;
          e.preventDefault();
          onPasteList(txt.split("\n").map((l) => l.trim()).filter(Boolean));
        }}
        placeholder={placeholder}
        maxLength={60}
        className="h-9 text-[13px] flex-1"
      />
      <ImageCell image={image} onImage={onImage} imageHint={imageHint} onBadImage={onBadImage} />
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        className="size-9 shrink-0 grid place-items-center rounded-lg text-faint hover:text-no-strong hover:bg-no-soft cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Remove option"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

// Curated Lucide glyphs for the market icon. A pick serializes the rendered
// <svg> to a data URI so it rides the existing imageUrl pipeline.
const ICON_PICK = [
  TrendingUp, Trophy, Coins, Zap, Globe, Flag, Star, Heart, Users, Gamepad2,
  Music, Plane, Car, Home, Cpu, Film, Landmark, Rocket, CalendarDays, Target,
];

function IconPicker({ onPick, hint }: { onPick: (v: string) => void; hint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        title={hint}
        onClick={() => setOpen((v) => !v)}
        className="size-10 grid place-items-center rounded-lg border border-dashed border-line text-faint hover:text-ink hover:border-faint cursor-pointer"
      >
        <Shapes className="size-4" />
      </button>
      {open && (
        <div className="absolute left-0 top-11 z-20 grid w-[188px] grid-cols-5 gap-0.5 rounded-xl border border-line bg-surface p-1.5 shadow-[0_8px_24px_rgba(16,16,20,0.12)]">
          {ICON_PICK.map((Icon, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                // SAFETY: lucide buttons always render a single svg child.
                const svg = e.currentTarget.querySelector("svg")?.outerHTML;
                if (svg) onPick(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
                setOpen(false);
              }}
              className="size-8.5 grid place-items-center rounded-md text-mute hover:bg-surface-2 hover:text-ink cursor-pointer"
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Compact image picker cell: click to upload, paste an image or URL, drop a
// file, right-click for a URL field. Uploads compress to data-URLs.
function ImageCell({
  image,
  onImage,
  imageHint,
  onBadImage,
  className = "size-9",
}: {
  image: string;
  onImage: (v: string) => void;
  imageHint: string;
  onBadImage: () => void;
  className?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlMode, setUrlMode] = useState(false);

  const acceptFile = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return onBadImage();
    onImage(await compressImage(f));
  };

  if (image)
    return (
      <div className={cn("relative shrink-0 group", className)}>
        <img src={image} alt="" className="size-full rounded-lg border border-line object-cover" />
        <button
          type="button"
          onClick={() => onImage("")}
          className="absolute -right-1.5 -top-1.5 size-4.5 rounded-full bg-ink text-surface grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          aria-label="Remove image"
        >
          <X className="size-3" />
        </button>
      </div>
    );

  if (urlMode)
    return (
      <input
        autoFocus
        placeholder="https://…"
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && /^(https?:\/\/|\/)\S+$/.test(v)) onImage(v);
          setUrlMode(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { e.currentTarget.value = ""; e.currentTarget.blur(); }
        }}
        className="h-9 w-24 shrink-0 rounded-lg border border-line bg-surface px-2 text-[12px] focus:outline-2 focus:outline-brand"
      />
    );

  return (
    <>
      <button
        type="button"
        title={imageHint}
        onClick={() => fileRef.current?.click()}
        onContextMenu={(e) => {
          e.preventDefault();
          setUrlMode(true);
        }}
        onPaste={async (e) => {
          const f = e.clipboardData?.files?.[0];
          if (f) {
            e.preventDefault();
            await acceptFile(f);
            return;
          }
          const txt = e.clipboardData?.getData("text")?.trim();
          if (txt && /^(https?:\/\/|\/)\S+$/.test(txt)) {
            e.preventDefault();
            onImage(txt);
          }
        }}
        onDrop={async (e) => {
          e.preventDefault();
          await acceptFile(e.dataTransfer?.files?.[0]);
        }}
        onDragOver={(e) => e.preventDefault()}
        className={cn("shrink-0 grid place-items-center rounded-lg border border-dashed border-line text-faint hover:text-ink hover:border-faint cursor-pointer", className)}
      >
        <ImagePlus className="size-4" />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          await acceptFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );
}
