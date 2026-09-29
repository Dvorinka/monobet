"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Input, Select, Textarea, Card, Segmented } from "@/components/ui/primitives";
import { proposeMarket } from "@/lib/actions";
import { CATEGORIES } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const LIQUIDITY = [
  { b: 100, label: "Thin", hint: "Trades swing the price hard" },
  { b: 300, label: "Standard", hint: "Balanced" },
  { b: 900, label: "Deep", hint: "Prices move slowly" },
] as const;

export function MarketForm({ isAdmin }: { isAdmin: boolean }) {
  const [marketType, setMarketType] = useState<"binary" | "multi">("binary");
  const [question, setQuestion] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("Friends");
  const [closesAt, setClosesAt] = useState("");
  const [odds, setOdds] = useState(50);
  const [liquidity, setLiquidity] = useState<number>(300);
  const [pending, start] = useTransition();
  const router = useRouter();

  const optionLines = optionsText.split("\n").map((o) => o.trim()).filter(Boolean);

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
              closesAt: closesAt || undefined,
              initialProb: odds / 100,
              liquidity,
              outcomes: marketType === "multi" ? optionLines : undefined,
            });
            if (r.ok) {
              toast.success("Market is live");
              router.push(`/market/${r.slug}`);
            } else toast.error(r.error);
          });
        }}
      >
        <div>
          <label className="text-[13px] font-medium text-mute">Market type</label>
          <Segmented
            className="mt-1.5 w-full"
            options={[
              { value: "binary", label: "Yes / No" },
              { value: "multi", label: "Multiple options" },
            ]}
            value={marketType}
            onChange={(v) => setMarketType(v as "binary" | "multi")}
          />
          <p className="mt-1.5 text-[11.5px] text-faint">
            {marketType === "binary"
              ? "One question, two sides — like “Will it snow before Christmas?”"
              : "One question, several options — like “Crude oil all-time high by when?” Each option gets its own Yes/No price."}
          </p>
        </div>

        <div>
          <label className="text-[13px] font-medium text-mute" htmlFor="q">
            Question
          </label>
          <Input
            id="q"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={marketType === "binary" ? "Will it snow in Prague before Christmas?" : "Crude oil all time high by…?"}
            maxLength={200}
            className="mt-1"
            required
          />
          <p className="mt-1 text-[11.5px] text-faint">
            {marketType === "binary" ? "A clear yes/no question." : "The shared question — options complete it."} {200 - question.length} chars left.
          </p>
        </div>

        {marketType === "multi" && (
          <div>
            <label className="text-[13px] font-medium text-mute" htmlFor="opts">
              Options
            </label>
            <Textarea
              id="opts"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder={"September 30\nOctober 31\nDecember 31"}
              className="mt-1 min-h-24 font-mono text-[13px]"
              required
            />
            <p className="mt-1 text-[11.5px] text-faint">
              One option per line — 2 to 12. {optionLines.length} added. Each trades as its own Yes/No market.
            </p>
          </div>
        )}

        <div>
          <label className="text-[13px] font-medium text-mute" htmlFor="d">
            Resolution rules
          </label>
          <Textarea
            id="d"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="How will this be decided? Source, deadline, edge cases…"
            maxLength={5000}
            className="mt-1 min-h-28"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[13px] font-medium text-mute" htmlFor="c">
              Category
            </label>
            <Select id="c" value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-[13px] font-medium text-mute" htmlFor="t">
              Betting closes (optional)
            </label>
            <Input
              id="t"
              type="datetime-local"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="text-[13px] font-medium text-mute" htmlFor="odds">
              Starting odds
            </label>
            <span className="num text-[13px] font-bold text-ink">{odds}%</span>
          </div>
          <div className="mt-2 flex h-9 overflow-hidden rounded-lg border border-line">
            <div
              className="grid place-items-center bg-yes-soft text-yes-strong text-[12.5px] font-bold transition-all duration-150"
              style={{ width: `${odds}%` }}
            >
              {odds >= 14 && `Yes ${odds}%`}
            </div>
            <div className="grid flex-1 place-items-center bg-no-soft text-no-strong text-[12.5px] font-bold">
              {odds <= 86 && `No ${100 - odds}%`}
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
          <p className="text-[11.5px] text-faint">
            Where {marketType === "multi" ? "every option" : "the price"} opens. Traders move it from here.
          </p>
        </div>

        <div>
          <label className="text-[13px] font-medium text-mute">Liquidity</label>
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
          {pending ? "Creating…" : "Create market"}
        </Button>

        <p className="text-[12px] text-faint text-center">
          Goes live for everyone the moment you create it.
          {isAdmin ? " You're admin — you can edit, resolve, or cancel it anytime." : " Admins can resolve or cancel markets later."}
        </p>
      </form>
    </Card>
  );
}
