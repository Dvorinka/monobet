"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Segmented, Button } from "@/components/ui/primitives";
import { sharesForSpend, tradeCost, yesPrice } from "@/lib/lmsr";
import { fmtMonos, fmtCents, fmtShares } from "@/lib/money";
import { playSfx } from "@/lib/sfx";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { placeTrade } from "@/lib/actions";

export function TradeTicket({
  marketId,
  qYes,
  qNo,
  b,
  live,
  userBalanceCents,
  signedIn,
  heldYes,
  heldNo,
  maxLeverage = 10,
  lang,
  title,
  defaultOutcome,
}: {
  marketId: string;
  qYes: number;
  qNo: number;
  b: number;
  live: boolean;
  userBalanceCents: number | null;
  signedIn: boolean;
  heldYes: number;
  heldNo: number;
  maxLeverage?: number;
  lang?: Lang;
  // Optional header (e.g. the selected option label on group markets).
  title?: React.ReactNode;
  // Preselected outcome — group rows' YES/NO chips carry ?side= into the ticket.
  defaultOutcome?: "yes" | "no";
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [outcome, setOutcome] = useState<"yes" | "no">(defaultOutcome ?? "yes");
  const [amount, setAmount] = useState("");
  const [leverage, setLeverage] = useState("1");
  const [pending, start] = useTransition();
  const router = useRouter();
  const t = getT(lang ?? "en");

  const py = yesPrice(qYes, qNo, b);
  const held = outcome === "yes" ? heldYes : heldNo;
  const spendCents = Math.round(parseFloat(amount || "0") * 100);
  const sellShares = parseFloat(amount || "0");

  const lev = Math.min(Number(leverage), maxLeverage);
  const est = useMemo(() => {
    if (side === "buy") {
      if (spendCents < 100) return null;
      const sh = sharesForSpend(qYes, qNo, b, outcome, (spendCents * lev) / 100);
      return { shares: sh, avg: (spendCents * lev) / 100 / sh, toWin: sh * 100 };
    }
    if (sellShares <= 0) return null;
    const refund = tradeCost(qYes, qNo, b, outcome, -sellShares);
    return { shares: sellShares, avg: refund / sellShares, toWin: Math.round(refund * 100) };
  }, [side, spendCents, sellShares, qYes, qNo, b, outcome, lev]);

  if (!live) return null;

  if (!signedIn) {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-5 text-center">
        <p className="text-sm font-medium text-ink">{t.loginToTrade}</p>
        <p className="text-[13px] text-mute mt-1">{t.signupBonusNote}</p>
        <Link href="/login">
          <Button className="mt-4 w-full">{t.loginSignup}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-[14px] border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,16,20,0.04)]">
      {title}
      <Segmented
        options={[
          { value: "buy", label: t.buy },
          { value: "sell", label: t.sell },
        ]}
        value={side}
        onChange={(v) => {
          setSide(v);
          setAmount("");
        }}
      />

      <div className="mt-3">
        <Segmented
          options={[
            { value: "yes", label: `${t.yes} ${fmtMonos(Math.round(py * 100), { lang })}`, tone: "yes" },
            { value: "no", label: `${t.no} ${fmtMonos(Math.round((1 - py) * 100), { lang })}`, tone: "no" },
          ]}
          value={outcome}
          onChange={setOutcome}
        />
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[13px] font-medium text-mute">
          <label htmlFor="amt">{side === "buy" ? t.amount : t.sharesLabel}</label>
          <span className="num">
            {side === "buy" ? `${t.balance} ${fmtMonos(userBalanceCents ?? 0, { lang })}` : `${t.holding} ${fmtShares(held, lang)}`}
          </span>
        </div>
        <div className="mt-1.5 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mute font-semibold text-sm">
            {side === "buy" ? "Ɱ" : "#"}
          </span>
          <input
            id="amt"
            type="number"
            min="0"
            step={side === "buy" ? "1" : "0.01"}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="num h-11 w-full rounded-lg border border-line bg-surface pl-8 pr-3 text-[15px] font-semibold text-ink placeholder:text-faint focus:outline-2 focus:outline-brand"
          />
        </div>
        <div className="mt-2 flex gap-1.5">
          {(side === "buy" ? [10, 50, 100, 500] : [10, 25, 50, 100]).map((v) => (
            <button
              key={v}
              onClick={() => {
                if (side === "buy") setAmount(String((parseFloat(amount || "0") + v).toFixed(0)));
                else setAmount(((held * v) / 100).toFixed(2));
              }}
              className="flex-1 h-7 rounded-md bg-surface-2 text-[12px] font-semibold text-mute hover:bg-surface-3 hover:text-ink cursor-pointer"
            >
              {side === "buy" ? `+Ɱ ${v}` : `${v}%`}
            </button>
          ))}
          <button
            onClick={() => setAmount(side === "buy" ? String((userBalanceCents ?? 0) / 100) : held.toFixed(2))}
            className="flex-1 h-7 rounded-md bg-surface-2 text-[12px] font-semibold text-mute hover:bg-surface-3 hover:text-ink cursor-pointer"
          >
            {t.max}
          </button>
        </div>
      </div>

      {side === "buy" && maxLeverage > 1 && (
        <div className="mt-3">
          <div className="text-[13px] font-medium text-mute mb-1.5">{t.leverage}</div>
          <Segmented
            options={["1", "2", "3", "5", "10", "25", "50", "100"]
              .filter((v) => Number(v) <= maxLeverage)
              .map((v) => ({ value: v, label: `${v}×` }))}
            value={leverage}
            onChange={setLeverage}
          />
          {lev > 1 && <p className="mt-1.5 text-[11px] text-faint">{t.liqNote}</p>}
        </div>
      )}

      {est && (
        <div className="mt-4 space-y-1.5 text-[13px]">
          <Row k={side === "buy" ? t.estShares : t.selling} v={fmtShares(est.shares, lang)} />
          <Row k={t.avgPrice} v={fmtCents(est.avg)} />
          {/* A big order sweeps the book — flag it when the fill price is far
              from the quoted chance so the numbers don't look contradictory. */}
          {side === "buy" &&
            (() => {
              const px = outcome === "yes" ? py : 1 - py;
              return est.avg > px * 1.15 && est.avg - px > 0.08 ? (
                <p className="text-[11px] leading-snug text-warn-strong">
                  {t.priceImpact(fmtCents(px), fmtCents(est.avg))}
                </p>
              ) : null;
            })()}
          {side === "buy" && lev > 1 && (
            <Row k={t.loanLabel} v={fmtMonos(spendCents * (lev - 1), { lang })} />
          )}
          {side === "buy" ? (
            <Row k={t.toWin} v={fmtMonos(est.toWin, { lang })} accent />
          ) : (
            <Row k={t.youReceive} v={fmtMonos(est.toWin, { lang })} accent />
          )}
        </div>
      )}

      <Button
        className="mt-4 w-full"
        size="lg"
        variant={side === "buy" ? (outcome === "yes" ? "yes" : "no") : "primary"}
        disabled={pending || !est}
        onClick={() =>
          start(async () => {
            const r = await placeTrade({
              marketId,
              outcome,
              side,
              spendCents: side === "buy" ? spendCents : undefined,
              shares: side === "sell" ? sellShares : undefined,
              leverage: side === "buy" ? lev : undefined,
            });
            if (r.ok) {
              playSfx("trade", 0.4);
              const oc = (outcome === "yes" ? t.yes : t.no).toUpperCase();
              toast.success(
                side === "buy"
                  ? t.boughtToast(fmtShares(r.shares, lang), oc, fmtMonos(r.costCents, { lang }))
                  : t.soldToast(fmtShares(r.shares, lang), oc, fmtMonos(r.costCents, { lang })),
                { description: t.priceMoved(Math.round(py * 100), Math.round(r.price * 100)) }
              );
              setAmount("");
              router.refresh();
            } else {
              toast.error(r.error);
            }
          })
        }
      >
        {pending
          ? t.placing
          : `${side === "buy" ? t.buy : t.sell} ${(outcome === "yes" ? t.yes : t.no).toUpperCase()}`}
      </Button>

      <p className="mt-3 text-center text-[11px] text-faint">{t.playMoneyNote}</p>
    </div>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-mute">{k}</span>
      <span className={cn("num font-semibold", accent && "text-yes-strong")}>{v}</span>
    </div>
  );
}
