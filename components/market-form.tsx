"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Input, Select, Textarea, Card } from "@/components/ui/primitives";
import { proposeMarket } from "@/lib/actions";
import { CATEGORIES } from "@/lib/db/schema";

export function MarketForm({ isAdmin }: { isAdmin: boolean }) {
  const [question, setQuestion] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("Friends");
  const [closesAt, setClosesAt] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <Card className="p-6">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await proposeMarket({
              question,
              description,
              category,
              closesAt: closesAt || undefined,
            });
            if (r.ok) {
              if (r.live) {
                toast.success("Market is live");
                router.push(`/market/${r.slug}`);
              } else {
                toast.success("Submitted for admin review");
                setQuestion("");
                setDescription("");
                setClosesAt("");
                router.refresh();
              }
            } else toast.error(r.error);
          });
        }}
      >
        <div>
          <label className="text-[13px] font-medium text-mute" htmlFor="q">
            Question
          </label>
          <Input
            id="q"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Will it snow in Prague before Christmas?"
            maxLength={200}
            className="mt-1"
            required
          />
          <p className="mt-1 text-[11.5px] text-faint">A clear yes/no question. {200 - question.length} chars left.</p>
        </div>

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

        <Button className="w-full" size="lg" disabled={pending}>
          {pending ? "…" : isAdmin ? "Create live market" : "Submit for review"}
        </Button>

        {!isAdmin && (
          <p className="text-[12px] text-faint text-center">
            An admin reviews proposals before trading opens.
          </p>
        )}
      </form>
    </Card>
  );
}
