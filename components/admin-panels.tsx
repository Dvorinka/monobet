"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button, Input, Select } from "@/components/ui/primitives";
import { approveMarket, rejectMarket, resolveMarket, cancelMarket, grantBalance } from "@/lib/actions";
import { fmtMarks, fmtDate } from "@/lib/money";
import { Check, X, CircleCheck, Ban } from "lucide-react";

function useAction() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; paidOut?: number }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.paidOut ? `${ok} — paid out ${fmtMarks(r.paidOut)}` : ok);
        router.refresh();
      } else toast.error(r.error);
    });
  return { pending, run };
}

export function PendingList({
  items,
}: {
  items: { id: string; slug: string; question: string; category: string; createdAt: Date; username: string | null }[];
}) {
  const { pending, run } = useAction();
  if (items.length === 0) return <p className="p-4 text-sm text-mute">No proposals waiting.</p>;
  return (
    <div className="divide-y divide-line-2">
      {items.map((m) => (
        <div key={m.id} className="px-4 py-3.5 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <Link href={`/market/${m.slug}`} className="text-sm font-medium hover:underline underline-offset-2 line-clamp-1">
              {m.question}
            </Link>
            <div className="text-[11.5px] text-faint mt-0.5">
              {m.category} · by @{m.username ?? "?"} · {fmtDate(m.createdAt)}
            </div>
          </div>
          <Button size="sm" variant="yes" disabled={pending} onClick={() => run(() => approveMarket(m.id), "Market approved")}>
            <Check className="size-3.5" /> Approve
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => rejectMarket(m.id), "Rejected")}>
            <X className="size-3.5" /> Reject
          </Button>
        </div>
      ))}
    </div>
  );
}

export function LiveMarketList({
  items,
}: {
  items: { id: string; slug: string; question: string; category: string; volumeCents: number; traderCount: number; closesAt: Date | null }[];
}) {
  const { pending, run } = useAction();
  if (items.length === 0) return <p className="p-4 text-sm text-mute">No live markets.</p>;
  return (
    <div className="divide-y divide-line-2">
      {items.map((m) => (
        <div key={m.id} className="px-4 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <Link href={`/market/${m.slug}`} className="text-sm font-medium hover:underline underline-offset-2 line-clamp-1">
                {m.question}
              </Link>
              <div className="text-[11.5px] text-faint mt-0.5">
                {fmtMarks(m.volumeCents)} vol · {m.traderCount} traders · closes {fmtDate(m.closesAt)}
              </div>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Button
              size="xs"
              variant="yes"
              disabled={pending}
              onClick={() => run(() => resolveMarket({ marketId: m.id, outcome: "yes" }), "Resolved YES")}
            >
              <CircleCheck className="size-3" /> Resolve Yes
            </Button>
            <Button
              size="xs"
              variant="no"
              disabled={pending}
              onClick={() => run(() => resolveMarket({ marketId: m.id, outcome: "no" }), "Resolved NO")}
            >
              <CircleCheck className="size-3" /> Resolve No
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (confirm("Cancel this market? Positions are refunded at current value."))
                  run(() => cancelMarket(m.id), "Market cancelled & refunded");
              }}
            >
              <Ban className="size-3" /> Cancel & refund
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function GrantPanel({ users }: { users: { id: string; username: string | null; balanceCents: number }[] }) {
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const { pending, run } = useAction();

  return (
    <form
      className="p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const cents = Math.round(parseFloat(amount || "0") * 100);
        run(
          () => grantBalance({ userId, amountCents: cents, memo }),
          `Granted ${fmtMarks(cents)}`
        );
        setAmount("");
        setMemo("");
      }}
    >
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              @{u.username ?? u.id.slice(0, 8)} ({fmtMarks(u.balanceCents)})
            </option>
          ))}
        </Select>
        <Input type="number" step="0.01" placeholder="Ɱ amount" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </div>
      <Input placeholder="Memo (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={100} />
      <Button size="sm" disabled={pending || !userId}>
        {pending ? "…" : "Grant / deduct"}
      </Button>
      <p className="text-[11.5px] text-faint">Negative amounts deduct. Every grant is logged in the member&rsquo;s cash flow.</p>
    </form>
  );
}
