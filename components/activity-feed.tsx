import { fmtMarks, fmtShares, timeAgo } from "@/lib/money";
import { cn } from "@/lib/utils";

export type TradeRow = {
  id: string;
  side: string;
  outcome: string;
  shares: string;
  amountCents: number;
  createdAt: Date;
  username: string | null;
  name: string;
};

export function ActivityFeed({ trades }: { trades: TradeRow[] }) {
  if (trades.length === 0) {
    return <p className="text-[13px] text-faint py-4">No trades yet. Be the first mover.</p>;
  }
  return (
    <div className="divide-y divide-line-2">
      {trades.map((t) => {
        const buy = t.side === "buy";
        const yes = t.outcome === "yes";
        return (
          <div key={t.id} className="py-2.5 flex items-center gap-3 text-[13px]">
            <span className="font-medium w-28 truncate">@{t.username ?? t.name}</span>
            <span className="text-mute">{buy ? "bought" : "sold"}</span>
            <span
              className={cn(
                "font-bold px-1.5 rounded",
                yes ? "text-yes-strong bg-yes-soft" : "text-no-strong bg-no-soft"
              )}
            >
              {t.outcome.toUpperCase()}
            </span>
            <span className="num text-mute">{fmtShares(Number(t.shares))} shares</span>
            <span className="num ml-auto font-semibold">{fmtMarks(t.amountCents)}</span>
            <span className="text-faint text-[11.5px] w-16 text-right">{timeAgo(t.createdAt)}</span>
          </div>
        );
      })}
    </div>
  );
}
