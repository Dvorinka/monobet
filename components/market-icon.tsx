import { createElement } from "react";
import {
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
} from "lucide-react";
import { optionColor, optionSoftBg } from "@/lib/option-style";
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
