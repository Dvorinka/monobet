import Link from "next/link";
import { createElement } from "react";
import {
  MessageSquare,
  Users,
  Clock,
  Landmark,
  Trophy,
  Bitcoin,
  Cpu,
  Sparkles,
  Heart,
  Shapes,
  Globe2,
  Fuel,
  Thermometer,
  Rocket,
  Clapperboard,
  Layers,
} from "lucide-react";
import type { MarketRow } from "@/lib/queries";
import { marketYesPrice } from "@/lib/queries";
import { optionColor, optionSoftBg } from "@/lib/option-style";
import { fmtCents, fmtMarks, fmtDate } from "@/lib/money";
import { Sparkline } from "@/components/sparkline";
import { AnimatedPct } from "@/components/animated-number";
import { Badge } from "@/components/ui/primitives";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const CAT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  Politics: Landmark,
  Geopolitics: Globe2,
  Sports: Trophy,
  Crypto: Bitcoin,
  Tech: Cpu,
  Culture: Sparkles,
  Friends: Heart,
  Other: Shapes,
};

// Topic-specific icons win over the generic category icon — a crude-oil
// market gets a barrel, not a globe.
const KEYWORD_ICON: [RegExp, React.ComponentType<{ className?: string }>][] = [
  [/\b(oil|crude|petrol|gas price|fuel|energy|opec)\b/i, Fuel],
  [/\b(weather|snow|rain|temperature|storm|heat wave|cold)\b/i, Thermometer],
  [/\b(spacex|rocket|nasa|mars|moon|launch)\b/i, Rocket],
  [/\b(movie|film|oscar|album|song|concert|box office)\b/i, Clapperboard],
];

export function iconForMarket(m: { question: string; category: string }) {
  for (const [re, icon] of KEYWORD_ICON) if (re.test(m.question)) return icon;
  return CAT_ICON[m.category] ?? Shapes;
}

export function iconForOption(label: string) {
  for (const [re, icon] of KEYWORD_ICON) if (re.test(label)) return icon;
  return null;
}

// Per-option avatar: uploaded image first, then a keyword icon when the label
// matches a topic, else a monogram letter — like Polymarket's party/outcome
// logos. Color is fixed by option index so the chip matches the chart line.
export function OptionChip({ label, index, imageUrl }: { label: string; index: number; imageUrl?: string | null }) {
  const color = optionColor(index);
  const icon = iconForOption(label);
  return (
    <span
      className="grid place-items-center size-7 rounded-md shrink-0 select-none text-[13px] font-bold overflow-hidden"
      style={{ background: optionSoftBg(color), color }}
      aria-hidden
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote option logos
        <img src={imageUrl} alt="" className="size-full object-cover" loading="lazy" />
      ) : icon ? (
        createElement(icon, { className: "size-4" })
      ) : (
        label.trim().charAt(0).toUpperCase()
      )}
    </span>
  );
}

export function MarketIcon({ market, size = "size-10" }: { market: { question: string; category: string; imageUrl?: string | null }; size?: string }) {
  return (
    <div className={cn("grid place-items-center rounded-lg bg-surface-2 border border-line-2 shrink-0 select-none overflow-hidden", size)}>
      {market.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote market icons
        <img src={market.imageUrl} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        createElement(iconForMarket(market), { className: "size-5 text-mute" })
      )}
    </div>
  );
}

const CARD =
  "group flex flex-col rounded-[14px] border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,16,20,0.04)] hover:shadow-[0_6px_20px_rgba(16,16,20,0.09)] hover:border-faint/60 hover:-translate-y-0.5 transition-all duration-200 anim-rise";

export function MarketCard({
  market,
  spark,
  comments = 0,
  index = 0,
  options,
  lang,
}: {
  market: MarketRow;
  spark: number[];
  comments?: number;
  index?: number;
  options?: MarketRow[];
  lang?: Lang;
}) {
  const t = getT(lang ?? "en");
  if (market.kind === "group") return <GroupCard market={market} options={options ?? []} index={index} lang={lang} />;

  const py = marketYesPrice(market);
  const resolved = market.status === "resolved";
  const cancelled = market.status === "cancelled" || market.status === "rejected";

  return (
    <Link href={`/market/${market.slug}`} className={CARD} style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
      <div className="flex gap-3">
        <MarketIcon market={market} />
        <h3 className="font-semibold text-[15px] leading-snug text-ink line-clamp-2 flex-1 group-hover:underline decoration-1 underline-offset-2">
          {market.question}
        </h3>
        <Sparkline points={spark} className="shrink-0 self-start" />
      </div>

      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="num text-[26px] font-bold leading-none tracking-tight">
            {resolved ? (
              <Badge tone={market.outcome === "yes" ? "yes" : "no"}>
                {(market.outcome === "yes" ? t.yes : t.no).toUpperCase()} {t.won}
              </Badge>
            ) : cancelled ? (
              <Badge tone="mute">{t.cancelled}</Badge>
            ) : market.status === "pending" ? (
              <Badge tone="warn">{t.pendingApproval}</Badge>
            ) : (
              <AnimatedPct value={py} className={py >= 0.5 ? "text-yes" : "text-ink"} />
            )}
          </div>
          {market.status === "live" && <div className="text-[11px] text-mute mt-1.5 font-medium">{t.chance}</div>}
        </div>
      </div>

      {market.status === "live" && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <span className="grid place-items-center h-8.5 rounded-md bg-yes-soft text-yes-strong text-[13px] font-semibold">
            {t.buyYes} {fmtCents(py)}
          </span>
          <span className="grid place-items-center h-8.5 rounded-md bg-no-soft text-no-strong text-[13px] font-semibold">
            {t.buyNo} {fmtCents(1 - py)}
          </span>
        </div>
      )}

      <div className="mt-auto pt-3 flex items-center gap-3.5 text-[11.5px] text-mute font-medium">
        <span className="num">{fmtMarks(market.volumeCents, { lang })} {t.vol}</span>
        <span className="inline-flex items-center gap-1">
          <Users className="size-3" />
          {market.traderCount}
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="size-3" />
          {comments}
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          <Clock className="size-3" />
          {fmtDate(market.closesAt, lang)}
        </span>
      </div>
    </Link>
  );
}

// Multi-outcome card — Polymarket's "X by when?" style. Each option row links
// to its own binary market; resolved options collapse under "View resolved".
function GroupCard({ market, options, index, lang }: { market: MarketRow; options: MarketRow[]; index: number; lang?: Lang }) {
  const t = getT(lang ?? "en");
  const live = options.filter((o) => o.status === "live");
  const closed = options.filter((o) => o.status !== "live");
  const volume = options.reduce((s, o) => s + o.volumeCents, 0);
  const traders = options.reduce((s, o) => s + o.traderCount, 0);
  // Color index must match the option's position in the full list — same color
  // on the card, the group page, and the chart.
  const idxOf = new Map(options.map((o, i) => [o.id, i]));

  return (
    <div className={CARD} style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
      <div className="flex gap-3">
        <MarketIcon market={market} />
        <h3 className="font-semibold text-[15px] leading-snug text-ink line-clamp-2 flex-1">
          <Link href={`/market/${market.slug}`} className="hover:underline decoration-1 underline-offset-2">
            {market.question}
          </Link>
        </h3>
        <span className="inline-flex items-center gap-1 h-5 rounded-full bg-surface-2 border border-line-2 px-2 text-[10.5px] font-semibold text-mute shrink-0 select-none">
          <Layers className="size-3" />
          {options.length}
        </span>
      </div>

      <div className="mt-3 -mx-1 divide-y divide-line-2">
        {live.slice(0, 4).map((o) => (
          <OptionRow key={o.id} option={o} index={idxOf.get(o.id) ?? 0} lang={lang} />
        ))}
        {live.length > 4 && (
          <Link href={`/market/${market.slug}`} className="block px-1 pt-2 text-[12px] font-semibold text-brand-strong hover:underline">
            {t.moreOptions(live.length - 4)}
          </Link>
        )}
      </div>

      {closed.length > 0 && (
        <details className="group/det mt-1 -mx-1">
          <summary className="cursor-pointer list-none px-1 py-1.5 text-[12px] font-semibold text-mute hover:text-ink select-none">
            {t.viewResolved(closed.length)}
          </summary>
          <div className="divide-y divide-line-2">
            {closed.map((o) => (
              <OptionRow key={o.id} option={o} index={idxOf.get(o.id) ?? 0} lang={lang} />
            ))}
          </div>
        </details>
      )}

      <div className="mt-auto pt-3 flex items-center gap-3.5 text-[11.5px] text-mute font-medium">
        <span className="num">{fmtMarks(volume, { lang })} {t.vol}</span>
        <span className="inline-flex items-center gap-1">
          <Users className="size-3" />
          {traders}
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          <Clock className="size-3" />
          {fmtDate(market.closesAt, lang)}
        </span>
      </div>
    </div>
  );
}

function OptionRow({ option: o, index, lang }: { option: MarketRow; index: number; lang?: Lang }) {
  const t = getT(lang ?? "en");
  const py = marketYesPrice(o);
  const resolved = o.status === "resolved";
  return (
    <Link
      href={`/market/${o.slug}`}
      className="flex items-center gap-2.5 px-1 py-2 rounded-md hover:bg-surface-2 transition-colors"
    >
      <OptionChip label={o.label ?? o.question} index={index} imageUrl={o.imageUrl} />
      <span className="text-[13px] font-medium text-ink truncate min-w-0 flex-1">
        {o.label}
        {o.volumeCents > 0 && (
          <span className="num text-[10.5px] text-faint font-medium ml-1.5 whitespace-nowrap">
            {fmtMarks(o.volumeCents, { lang })} {t.vol}
          </span>
        )}
      </span>
      {resolved ? (
        <Badge tone={o.outcome === "yes" ? "yes" : "no"} className="shrink-0">
          {(o.outcome === "yes" ? t.yes : t.no).toUpperCase()}
        </Badge>
      ) : o.status === "cancelled" ? (
        <Badge tone="mute" className="shrink-0">{t.cancelled}</Badge>
      ) : (
        <>
          <span className={cn("num w-10 text-right text-[14px] font-bold shrink-0", py >= 0.5 ? "text-yes" : "text-ink")}>
            {Math.round(py * 100)}%
          </span>
          <span className="num grid place-items-center h-7 w-16 rounded-md bg-yes-soft text-yes-strong text-[12px] font-semibold shrink-0">
            {t.yes} {fmtCents(py)}
          </span>
          <span className="num grid place-items-center h-7 w-16 rounded-md bg-no-soft text-no-strong text-[12px] font-semibold shrink-0">
            {t.no} {fmtCents(1 - py)}
          </span>
        </>
      )}
    </Link>
  );
}
