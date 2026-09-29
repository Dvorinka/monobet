"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button, Input, Select, Badge } from "@/components/ui/primitives";
import { approveMarket, rejectMarket, resolveMarket, cancelMarket, grantBalance, createCategory, renameCategory, deleteCategory, deleteMarket, adminCreateUser, adminSetUserBanned, adminSetCommentsBanned, adminSetUserRole, adminResetUserPassword } from "@/lib/actions";
import { fmtMarks, fmtDate } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { Check, X, CircleCheck, Ban, Pencil, Trash2, KeyRound, MessageSquareOff, MessageSquare, ShieldPlus, ShieldMinus } from "lucide-react";

function useAction(lang?: Lang) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; paidOut?: number }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.paidOut ? `${ok} — ${fmtMarks(r.paidOut, { lang })}` : ok);
        router.refresh();
      } else toast.error(r.error);
    });
  return { pending, run };
}

export function PendingList({
  items,
  lang,
}: {
  items: { id: string; slug: string; question: string; category: string; createdAt: Date; username: string | null }[];
  lang?: Lang;
}) {
  const { pending, run } = useAction(lang);
  const t = getT(lang ?? "en");
  if (items.length === 0) return <p className="p-4 text-sm text-mute">{t.noPending}</p>;
  return (
    <div className="divide-y divide-line-2">
      {items.map((m) => (
        <div key={m.id} className="px-4 py-3.5 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <Link href={`/market/${m.slug}`} className="text-sm font-medium hover:underline underline-offset-2 line-clamp-1">
              {m.question}
            </Link>
            <div className="text-[11.5px] text-faint mt-0.5">
              {m.category} · {t.pendingBy} @{m.username ?? "?"} · {fmtDate(m.createdAt, lang)}
            </div>
          </div>
          <Button size="sm" variant="yes" disabled={pending} onClick={() => run(() => approveMarket(m.id), t.approvedToast)}>
            <Check className="size-3.5" /> {t.approve}
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => rejectMarket(m.id), t.rejectedToast)}>
            <X className="size-3.5" /> {t.reject}
          </Button>
          <Button
            size="sm"
            variant="no"
            disabled={pending}
            title={t.deleteMarket}
            onClick={() => {
              if (confirm(t.deleteMarketConfirm(m.question))) run(() => deleteMarket(m.id), t.marketDeleted);
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

export function LiveMarketList({
  items,
  lang,
}: {
  items: { id: string; slug: string; question: string; category: string; volumeCents: number; traderCount: number; closesAt: Date | null; kind?: string }[];
  lang?: Lang;
}) {
  const { pending, run } = useAction(lang);
  const t = getT(lang ?? "en");
  if (items.length === 0) return <p className="p-4 text-sm text-mute">{t.noLive}</p>;
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
                {fmtMarks(m.volumeCents, { lang })} {t.vol.toLowerCase()} · {m.traderCount} {t.tradersW} · {t.closes.toLowerCase()} {fmtDate(m.closesAt, lang)}
              </div>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {m.kind !== "group" && (
              <>
                <Button
                  size="xs"
                  variant="yes"
                  disabled={pending}
                  onClick={() => run(() => resolveMarket({ marketId: m.id, outcome: "yes" }), t.resolvedYesToast)}
                >
                  <CircleCheck className="size-3" /> {t.resolveYes}
                </Button>
                <Button
                  size="xs"
                  variant="no"
                  disabled={pending}
                  onClick={() => run(() => resolveMarket({ marketId: m.id, outcome: "no" }), t.resolvedNoToast)}
                >
                  <CircleCheck className="size-3" /> {t.resolveNo}
                </Button>
              </>
            )}
            {m.kind !== "group" && (
              <Button
                size="xs"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  if (confirm(t.cancelConfirm))
                    run(() => cancelMarket(m.id), t.cancelledToast);
                }}
              >
                <Ban className="size-3" /> {t.cancelRefund}
              </Button>
            )}
            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              className="text-no-strong hover:bg-no-soft border-no/30"
              onClick={() => {
                if (confirm(t.deleteMarketConfirm(m.question))) run(() => deleteMarket(m.id), t.marketDeleted);
              }}
            >
              <Trash2 className="size-3" /> {t.delete}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function GrantPanel({ users, lang }: { users: { id: string; username: string | null; balanceCents: number }[]; lang?: Lang }) {
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const { pending, run } = useAction(lang);
  const t = getT(lang ?? "en");

  return (
    <form
      className="p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const cents = Math.round(parseFloat(amount || "0") * 100);
        run(
          () => grantBalance({ userId, amountCents: cents, memo }),
          t.grantedToast(fmtMarks(cents, { lang }))
        );
        setAmount("");
        setMemo("");
      }}
    >
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              @{u.username ?? u.id.slice(0, 8)} ({fmtMarks(u.balanceCents, { lang })})
            </option>
          ))}
        </Select>
        <Input type="number" step="0.01" placeholder="Ɱ" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </div>
      <Input placeholder={t.memoPh} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={100} />
      <Button size="sm" disabled={pending || !userId}>
        {pending ? "…" : t.grant}
      </Button>
      <p className="text-[11.5px] text-faint">{t.grantNote}</p>
    </form>
  );
}

// Admin user creation — username + password, optional admin role.
export function UsersPanel({ lang }: { lang?: Lang }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [admin, setAdmin] = useState(false);
  const { pending, run } = useAction(lang);
  const t = getT(lang ?? "en");

  return (
    <form
      className="p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => adminCreateUser({ username, password, role: admin ? "admin" : "user" }),
          t.userCreated(username.trim().toLowerCase())
        );
        setUsername("");
        setPassword("");
        setAdmin(false);
      }}
    >
      <div className="grid grid-cols-[1fr_140px] gap-3">
        <Input placeholder={t.createUserPh} value={username} onChange={(e) => setUsername(e.target.value)} required />
        <Input type="password" placeholder={t.password} value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <div className="flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-[13px] text-mute cursor-pointer select-none">
          <input
            type="checkbox"
            checked={admin}
            onChange={(e) => setAdmin(e.target.checked)}
            className="size-4 accent-brand"
          />
          {t.makeAdmin}
        </label>
        <Button size="sm" disabled={pending || !username.trim() || password.length < 6}>
          {pending ? "…" : t.createUserBtn}
        </Button>
      </div>
    </form>
  );
}

// Admin user manager — every account with moderation controls: password
// reset, comment mute, full ban (drops sessions + blocks sign-in), role toggle.
// The acting admin and the owner account are protected server-side; the UI
// also hides controls on your own row.
export function UserManager({
  users,
  selfId,
  lang,
}: {
  users: {
    id: string;
    username: string | null;
    email: string | null;
    role: string;
    balanceCents: number;
    createdAt: Date;
    bannedAt: Date | null;
    commentsBanned: boolean;
  }[];
  selfId: string;
  lang?: Lang;
}) {
  const { pending, run } = useAction(lang);
  const t = getT(lang ?? "en");
  if (users.length === 0) return <p className="p-4 text-sm text-mute">{t.umNoUsers}</p>;
  return (
    <div className="divide-y divide-line-2">
      {users.map((u) => (
        <div key={u.id} className="px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
              <span className="truncate">@{u.username ?? u.id.slice(0, 8)}</span>
              {u.id === selfId && <Badge tone="ink">{t.umYou}</Badge>}
              {u.role === "admin" && <Badge tone="yes">{t.umAdmin}</Badge>}
              {u.bannedAt ? <Badge tone="no">{t.umBanned}</Badge> : u.commentsBanned && <Badge tone="warn">{t.umMuted}</Badge>}
            </div>
            <div className="text-[11.5px] text-faint mt-0.5 truncate">
              {u.email} · {fmtMarks(u.balanceCents, { lang })} · {fmtDate(u.createdAt, lang)}
            </div>
          </div>
          {u.id !== selfId && (
            <div className="flex flex-wrap justify-end gap-1.5 shrink-0">
              <Button
                size="xs"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  const pw = prompt(t.umNewPasswordFor(u.username ?? "?"));
                  if (pw === null) return;
                  if (pw.length < 6) return toast.error(t.authPassShort);
                  run(() => adminResetUserPassword({ userId: u.id, password: pw }), t.savedToast);
                }}
              >
                <KeyRound className="size-3" /> {t.umResetPw}
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(() => adminSetUserRole({ userId: u.id, role: u.role === "admin" ? "user" : "admin" }), t.savedToast)
                }
              >
                {u.role === "admin" ? <ShieldMinus className="size-3" /> : <ShieldPlus className="size-3" />}
                {u.role === "admin" ? t.umRemoveAdmin : t.umMakeAdmin}
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(() => adminSetCommentsBanned({ userId: u.id, banned: !u.commentsBanned }), t.savedToast)
                }
              >
                {u.commentsBanned ? <MessageSquare className="size-3" /> : <MessageSquareOff className="size-3" />}
                {u.commentsBanned ? t.umUnmute : t.umMute}
              </Button>
              <Button
                size="xs"
                variant={u.bannedAt ? "outline" : "no"}
                disabled={pending}
                onClick={() => {
                  if (u.bannedAt) return run(() => adminSetUserBanned({ userId: u.id, banned: false }), t.savedToast);
                  const reason = prompt(t.umBanReasonFor(u.username ?? "?"));
                  if (reason === null) return;
                  run(() => adminSetUserBanned({ userId: u.id, banned: true, reason }), t.savedToast);
                }}
              >
                <Ban className="size-3" /> {u.bannedAt ? t.umUnban : t.umBan}
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Admin category manager — rename carries markets over; delete only allowed on
// empty categories (the server enforces both).
export function CategoriesPanel({
  categories,
  lang,
}: {
  categories: { name: string; markets: number }[];
  lang?: Lang;
}) {
  const t = getT(lang ?? "en");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        after?.();
        router.refresh();
      } else toast.error(r.error);
    });

  return (
    <div className="p-4 space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          act(() => createCategory({ name: newName }), t.catCreated(newName.trim()), () => setNewName(""));
        }}
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t.addCategoryPh}
          maxLength={24}
          className="h-9 text-[13px]"
        />
        <Button size="sm" className="h-9 shrink-0" disabled={pending || !newName.trim()}>
          {t.addCategory}
        </Button>
      </form>

      <div className="divide-y divide-line-2">
        {categories.map((c) => (
          <div key={c.name} className="flex items-center gap-2 py-2">
            {editing === c.name ? (
              <form
                className="flex flex-1 items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!editValue.trim() || editValue.trim() === c.name) return setEditing(null);
                  act(
                    () => renameCategory({ from: c.name, to: editValue }),
                    t.catRenamed,
                    () => setEditing(null)
                  );
                }}
              >
                <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} maxLength={24} className="h-8 text-[13px]" autoFocus />
                <Button size="xs" className="h-8" disabled={pending}>{t.rename}</Button>
                <Button size="xs" variant="outline" className="h-8" type="button" onClick={() => setEditing(null)}>✕</Button>
              </form>
            ) : (
              <>
                <span className="flex-1 text-[13.5px] font-medium">{c.name}</span>
                <span className="text-[11px] text-faint num">{c.markets} {t.marketsN}</span>
                <button
                  type="button"
                  className="size-7 grid place-items-center rounded-md text-faint hover:text-ink hover:bg-surface-2 cursor-pointer"
                  title={t.rename}
                  onClick={() => {
                    setEditing(c.name);
                    setEditValue(c.name);
                  }}
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="size-7 grid place-items-center rounded-md text-faint hover:text-no-strong hover:bg-no-soft cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title={c.markets > 0 ? `${c.markets} ${t.categoryInUse}` : t.delete}
                  disabled={pending || c.markets > 0}
                  onClick={() => {
                    if (confirm(t.deleteCatConfirm(c.name)))
                      act(() => deleteCategory({ name: c.name }), t.catDeleted);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
