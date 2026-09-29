import Link from "next/link";
import { MessageSquare, Users, Clock, Landmark, Trophy, Bitcoin, Cpu, Sparkles, Heart, Shapes } from "lucide-react";
import type { MarketRow } from "@/lib/queries";
import { marketYesPrice } from "@/lib/queries";
import { fmtCents, fmtMarks, fmtDate } from "@/lib/money";
import { Sparkline } from "@/components/sparkline";
import { AnimatedPct } from "@/components/animated-number";
import { Badge } from "@/components/ui/primitives";

const CAT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  Politics: Landmark,
  Sports: Trophy,
  Crypto: Bitcoin,
  Tech: Cpu,
  Culture: Sparkles,
  Friends: Heart,
  Other: Shapes,
};

export function MarketCard({
  market,
  spark,
  comments = 0,
  index = 0,
}: {
  market: MarketRow;
  spark: number[];
  comments?: number;
  index?: number;
}) {
  const py = marketYesPrice(market);
  const resolved = market.status === "resolved";
  const cancelled = market.status === "cancelled" || market.status === "rejected";

  return (
    <Link
      href={`/market/${market.slug}`}
      className="group flex flex-col rounded-[14px] border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,16,20,0.04)] hover:shadow-[0_6px_20px_rgba(16,16,20,0.09)] hover:border-faint/60 hover:-translate-y-0.5 transition-all duration-200 anim-rise"
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
    >
      <div className="flex gap-3">
        <div className="grid place-items-center size-10 rounded-lg bg-surface-2 border border-line-2 shrink-0 select-none">
          {(() => {
            const Icon = CAT_ICON[market.category] ?? Shapes;
            return <Icon className="size-5 text-mute" />;
          })()}
        </div>
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
                {market.outcome?.toUpperCase()} won
              </Badge>
            ) : cancelled ? (
              <Badge tone="mute">Cancelled</Badge>
            ) : market.status === "pending" ? (
              <Badge tone="warn">Pending approval</Badge>
            ) : (
              <AnimatedPct
                value={py}
                className={py >= 0.5 ? "text-yes" : "text-ink"}
              />
            )}
          </div>
          {market.status === "live" && (
            <div className="text-[11px] text-mute mt-1.5 font-medium">chance</div>
          )}
        </div>
      </div>

      {market.status === "live" && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <span className="grid place-items-center h-8.5 rounded-md bg-yes-soft text-yes-strong text-[13px] font-semibold">
            Buy Yes {fmtCents(py)}
          </span>
          <span className="grid place-items-center h-8.5 rounded-md bg-no-soft text-no-strong text-[13px] font-semibold">
            Buy No {fmtCents(1 - py)}
          </span>
        </div>
      )}

      <div className="mt-auto pt-3 flex items-center gap-3.5 text-[11.5px] text-mute font-medium">
        <span className="num">{fmtMarks(market.volumeCents)} Vol.</span>
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
          {fmtDate(market.closesAt)}
        </span>
      </div>
    </Link>
  );
}
