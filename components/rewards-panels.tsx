"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { claimAdReward, claimBonus, claimDaily, claimWeekly } from "@/lib/actions";
import { getT, type Lang } from "@/lib/i18n";
import { AD_WATCH_MS } from "@/lib/rewards";
import { fmtMarks } from "@/lib/money";
import {
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clapperboard,
  ExternalLink,
  Gift,
  Lock,
  Play,
} from "lucide-react";

type Recurring = { nextAt: number | null; amount: string };
type BonusState = {
  key: string;
  amountCents: number;
  href: string | null;
  claimed: boolean;
  eligible: boolean;
};

function useRemaining(nextAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!nextAt) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [nextAt]);
  return nextAt ? Math.max(0, nextAt - now) : 0;
}

function RecurringCard({
  icon,
  title,
  desc,
  amount,
  nextAt,
  run,
  t,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  amount: string;
  nextAt: number | null;
  run: () => Promise<{ ok: boolean; error?: string; retryInH?: number }>;
  t: ReturnType<typeof getT>;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const remaining = useRemaining(nextAt);
  const ready = remaining <= 0;

  return (
    <div className="rounded-xl border border-line bg-surface p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="size-9 rounded-lg bg-brand-soft text-brand-strong flex items-center justify-center">{icon}</div>
        <span className="num text-sm font-bold text-yes">{amount}</span>
      </div>
      <div>
        <div className="text-[15px] font-semibold">{title}</div>
        <div className="text-[12.5px] text-mute mt-0.5">{desc}</div>
      </div>
      <button
        disabled={!ready || pending}
        onClick={() =>
          start(async () => {
            const r = await run();
            if (r.ok) {
              toast.success(`+${amount}`);
              router.refresh();
            } else {
              toast.error(r.error === "cooldown" ? t.availableIn(r.retryInH ?? 1) : r.error);
            }
          })
        }
        className="mt-auto h-9 rounded-lg bg-brand text-brand-on text-[13px] font-semibold hover:bg-brand-strong transition-all active:scale-[0.97] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
      >
        {pending ? "…" : ready ? t.claimNow : t.availableIn(Math.ceil((remaining - 30_000) / 3600000))}
      </button>
    </div>
  );
}

function AdCard({ nextAt, amount, t }: { nextAt: number | null; amount: string; t: ReturnType<typeof getT> }) {
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [adKey, setAdKey] = useState(0);
  const [pending, start] = useTransition();
  const router = useRouter();
  const remaining = useRemaining(nextAt);
  const ready = remaining <= 0;

  const startAd = () => {
    setAdKey((k) => k + 1);
    setLeft(Math.ceil(AD_WATCH_MS / 1000));
    setOpen(true);
  };

  useEffect(() => {
    if (left === null || left <= 0) return;
    const id = setTimeout(() => setLeft((v) => (v === null ? null : v - 1)), 1000);
    return () => clearTimeout(id);
  }, [left]);

  const adDone = left !== null && left <= 0;

  return (
    <div className="rounded-xl border border-line bg-surface p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="size-9 rounded-lg bg-brand-soft text-brand-strong flex items-center justify-center">
          <Clapperboard className="size-4.5" />
        </div>
        <span className="num text-sm font-bold text-yes">{amount}</span>
      </div>
      <div>
        <div className="text-[15px] font-semibold">{t.adReward}</div>
        <div className="text-[12.5px] text-mute mt-0.5">{t.adDesc}</div>
      </div>
      <button
        disabled={!ready || pending}
        onClick={startAd}
        className="mt-auto h-9 rounded-lg bg-brand text-brand-on text-[13px] font-semibold hover:bg-brand-strong transition-all active:scale-[0.97] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 inline-flex items-center justify-center gap-1.5"
      >
        <Play className="size-3.5" />
        {ready ? t.watchAd : t.availableIn(Math.ceil((remaining - 30_000) / 3600000))}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => adDone && setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden border border-line bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="relative aspect-video">
              <iframe key={adKey} src="/ads/player.html" className="absolute inset-0 w-full h-full border-0" title="Ad" />
              <div className="absolute bottom-0 inset-x-0 h-1 bg-white/10">
                <div
                  className="h-full bg-brand transition-all duration-1000 ease-linear"
                  style={{ width: `${100 - (left ?? 0) * (100 / Math.ceil(AD_WATCH_MS / 1000))}%` }}
                />
              </div>
            </div>
            <div className="p-4 flex items-center justify-between gap-3">
              <span className="text-[12.5px] text-mute font-medium">
                {adDone ? t.claimNow : t.adEndsIn(left ?? 0)}
              </span>
              <button
                disabled={!adDone || pending}
                onClick={() =>
                  start(async () => {
                    const r = await claimAdReward();
                    setOpen(false);
                    setLeft(null);
                    if (r.ok) {
                      toast.success(`+${amount}`);
                      router.refresh();
                    } else {
                      toast.error(r.error === "cooldown" ? t.availableIn(r.retryInH ?? 1) : r.error);
                    }
                  })
                }
                className="h-8 px-4 rounded-lg bg-brand text-brand-on text-[13px] font-semibold hover:bg-brand-strong transition-all active:scale-[0.97] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                {t.claimNow}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InviteCard({ username, lang }: { username: string; lang: Lang }) {
  const t = getT(lang);
  const [copied, setCopied] = useState(false);
  const link = `https://monobet.tdvorak.dev/login?ref=${encodeURIComponent(username)}`;
  return (
    <div className="rounded-xl border border-line bg-surface p-4 flex items-center gap-3">
      <div className="size-9 rounded-lg bg-brand-soft text-brand-strong flex items-center justify-center shrink-0">
        <Gift className="size-4.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold flex items-center gap-2">
          {t.inviteTitle}
          <span className="num text-[12px] font-bold text-yes">+{fmtMarks(20_000, { lang, decimals: false })}</span>
        </div>
        <div className="text-[12px] text-mute">{t.inviteDesc}</div>
      </div>
      <button
        onClick={() => {
          navigator.clipboard.writeText(link);
          setCopied(true);
          toast.success(t.copied);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="h-8 px-3 rounded-lg bg-brand text-brand-on text-[12.5px] font-semibold hover:bg-brand-strong transition-all active:scale-[0.97] cursor-pointer shrink-0 inline-flex items-center gap-1.5"
      >
        {copied ? <CheckCircle2 className="size-3.5" /> : null}
        {copied ? t.copied : t.copyLink}
      </button>
    </div>
  );
}

export function RewardsPanels({
  lang,
  daily,
  weekly,
  ad,
  bonuses,
  username,
}: {
  lang: Lang;
  daily: Recurring;
  weekly: Recurring;
  ad: Recurring;
  bonuses: BonusState[];
  username: string;
}) {
  const t = getT(lang);
  const [pending, start] = useTransition();
  const router = useRouter();

  const bonusText: Record<string, { title: string; desc: string }> = {
    portfolio: { title: t.bonusPortfolio, desc: t.bonusPortfolioDesc },
    instagram: { title: t.bonusInstagram, desc: t.bonusInstagramDesc },
    github: { title: t.bonusGithub, desc: t.bonusGithubDesc },
    first_bet: { title: t.bonusFirstBet, desc: t.bonusFirstBetDesc },
    first_market: { title: t.bonusFirstMarket, desc: t.bonusFirstMarketDesc },
    first_comment: { title: t.bonusFirstComment, desc: t.bonusFirstCommentDesc },
  };

  return (
    <div className="mt-7 space-y-8">
      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-faint mb-3">{t.recurringRewards}</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <RecurringCard
            icon={<CalendarCheck className="size-4.5" />}
            title={t.dailyReward}
            desc={t.dailyDesc}
            amount={daily.amount}
            nextAt={daily.nextAt}
            run={claimDaily}
            t={t}
          />
          <RecurringCard
            icon={<CalendarDays className="size-4.5" />}
            title={t.weeklyReward}
            desc={t.weeklyDesc}
            amount={weekly.amount}
            nextAt={weekly.nextAt}
            run={claimWeekly}
            t={t}
          />
          <AdCard nextAt={ad.nextAt} amount={ad.amount} t={t} />
        </div>
      </section>

      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-faint mb-3">{t.oneTimeBonuses}</h2>
        <div className="mb-3">
          <InviteCard username={username} lang={lang} />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {bonuses.map((b) => {
            const txt = bonusText[b.key];
            const done = b.claimed;
            return (
              <div
                key={b.key}
                className={`rounded-xl border p-4 flex items-center gap-3 transition-colors ${
                  done ? "border-line bg-surface-2 opacity-70" : "border-line bg-surface"
                }`}
              >
                <div className="size-9 rounded-lg bg-brand-soft text-brand-strong flex items-center justify-center shrink-0">
                  <Gift className="size-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold flex items-center gap-2">
                    {txt.title}
                    <span className="num text-[12px] font-bold text-yes">
                      +{fmtMarks(b.amountCents, { lang, decimals: false })}
                    </span>
                  </div>
                  <div className="text-[12px] text-mute truncate">{txt.desc}</div>
                </div>
                {done ? (
                  <CheckCircle2 className="size-5 text-yes shrink-0" />
                ) : (
                  <div className="flex gap-1.5 shrink-0">
                    {b.href && (
                      <a
                        href={b.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="size-8 rounded-lg bg-surface-2 text-mute hover:text-ink inline-flex items-center justify-center transition-colors"
                        title={t.visit}
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                    <button
                      disabled={pending || !b.eligible}
                      onClick={() =>
                        start(async () => {
                          const r = await claimBonus(b.key);
                          if (r.ok) {
                            toast.success(`+${fmtMarks(b.amountCents, { lang, decimals: false })}`);
                            router.refresh();
                          } else toast.error(r.error);
                        })
                      }
                      className="h-8 px-3 rounded-lg bg-brand text-brand-on text-[12.5px] font-semibold hover:bg-brand-strong transition-all active:scale-[0.97] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 inline-flex items-center gap-1"
                      title={b.eligible ? t.claimNow : txt.desc}
                    >
                      {b.eligible ? t.claimNow : <Lock className="size-3.5" />}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
