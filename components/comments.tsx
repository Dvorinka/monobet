"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Avatar, Button, Textarea } from "@/components/ui/primitives";
import { addComment, deleteComment, voteComment } from "@/lib/actions";
import { timeAgo } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { ImagePlus, Reply, ThumbsDown, ThumbsUp, Trash2, X } from "lucide-react";

export type CommentRow = {
  id: string;
  body: string;
  imageUrl: string | null;
  createdAt: Date;
  userId: string;
  parentId: string | null;
  username: string | null;
  name: string;
  image: string | null;
  likes: number;
  dislikes: number;
  myVote: number;
};

// Client-side compression: cap at 1080px, JPEG ~0.7 → usually well under the
// server's 450KB data-URL cap.
export function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1080 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function Comments({
  marketId,
  comments,
  signedIn,
  currentUserId,
  viewerName,
  viewerImage,
  isAdmin,
  lang,
}: {
  marketId: string;
  comments: CommentRow[];
  signedIn: boolean;
  currentUserId?: string;
  viewerName?: string;
  viewerImage?: string | null;
  isAdmin?: boolean;
  lang?: Lang;
}) {
  const [body, setBody] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [sort, setSort] = useState<"new" | "top">("new");
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const t = getT(lang ?? "en");

  // One level of threading: replies group under their top-level parent.
  const topLevel = comments.filter((c) => !c.parentId);
  const replies = new Map<string, CommentRow[]>();
  for (const c of comments) {
    if (!c.parentId) continue;
    const arr = replies.get(c.parentId) ?? [];
    arr.push(c);
    replies.set(c.parentId, arr);
  }
  const sorted = [...topLevel].sort((a, b) =>
    sort === "top" ? b.likes - b.dislikes - (a.likes - a.dislikes) : 0
  );

  // Posts a comment/reply — resolves true on success so callers can clear
  // their local form state.
  const post = async (text: string, parentId?: string): Promise<boolean> => {
    const r = await addComment({ marketId, body: text, image, parentId });
    if (r.ok) {
      setBody("");
      setImage(null);
      router.refresh();
      return true;
    }
    toast.error(r.error);
    return false;
  };

  return (
    <div>
      {signedIn ? (
        <form
          className="flex gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            start(async () => {
              await post(body);
            });
          }}
        >
          <Avatar name={viewerName ?? "you"} image={viewerImage} className="size-8 mt-1" />
          <div className="flex-1">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t.addCommentPh}
              maxLength={1000}
              className="min-h-16"
            />
            {image && (
              <div className="relative mt-2 w-fit">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="" className="max-h-48 rounded-lg border border-line" />
                <button
                  type="button"
                  onClick={() => setImage(null)}
                  className="absolute -top-2 -right-2 size-5 rounded-full bg-ink text-surface flex items-center justify-center cursor-pointer"
                >
                  <X className="size-3" />
                </button>
              </div>
            )}
            <div className="mt-2 flex items-center justify-between">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  try {
                    setImage(await compressImage(f));
                  } catch {
                    toast.error(t.imageBad);
                  }
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-mute hover:text-ink cursor-pointer transition-colors"
              >
                <ImagePlus className="size-4" />
                {t.attachImage}
              </button>
              <Button size="sm" disabled={pending || !body.trim()}>
                {pending ? t.posting : t.comment}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <p className="text-[13px] text-mute">
          <Link href="/login" className="text-ink font-semibold underline underline-offset-2">
            {t.loginToComment}
          </Link>{" "}
          {t.toComment}
        </p>
      )}

      {comments.length > 1 && (
        <div className="mt-6 flex gap-1 text-[12px] font-semibold">
          {(["new", "top"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`px-2.5 py-1 rounded-md cursor-pointer transition-colors ${
                sort === s ? "bg-surface-2 text-ink" : "text-mute hover:text-ink"
              }`}
            >
              {s === "new" ? t.sortNewest : t.sortTop}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-5">
        {comments.length === 0 && <p className="text-[13px] text-faint">{t.noComments}</p>}
        {sorted.map((c) => (
          <div key={c.id} className="space-y-4">
            <CommentItem
              c={c}
              signedIn={signedIn}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              lang={lang}
              pending={pending}
              start={start}
              refresh={router.refresh}
              replySlot={signedIn ? (replyText) => post(replyText, c.id) : undefined}
            />
            {(replies.get(c.id) ?? []).map((r) => (
              <div key={r.id} className="ml-11">
                <CommentItem
                  c={r}
                  signedIn={signedIn}
                  currentUserId={currentUserId}
                  isAdmin={isAdmin}
                  lang={lang}
                  pending={pending}
                  start={start}
                  refresh={router.refresh}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

type Start = (fn: () => void | Promise<void>) => void;

// One comment row — used for top-level comments and their replies.
function CommentItem({
  c,
  signedIn,
  currentUserId,
  isAdmin,
  lang,
  pending,
  start,
  refresh,
  replySlot,
}: {
  c: CommentRow;
  signedIn: boolean;
  currentUserId?: string;
  isAdmin?: boolean;
  lang?: Lang;
  pending: boolean;
  start: Start;
  refresh: () => void;
  replySlot?: (text: string) => Promise<boolean>;
}) {
  const t = getT(lang ?? "en");
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");

  return (
    <div className="flex gap-3 group anim-rise">
      <Avatar name={c.username ?? c.name} image={c.image} className="size-8" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <Link href={`/u/${c.username ?? c.name}`} className="text-[13px] font-semibold hover:underline underline-offset-2">
            @{c.username ?? c.name}
          </Link>
          <span className="text-[11px] text-faint">{timeAgo(c.createdAt, lang)}</span>
          {(currentUserId === c.userId || isAdmin) && (
            <button
              className="opacity-0 group-hover:opacity-100 transition-opacity text-faint hover:text-no cursor-pointer"
              onClick={() =>
                start(async () => {
                  const r = await deleteComment(c.id);
                  if (r.ok) refresh();
                  else toast.error(r.error);
                })
              }
              aria-label={t.deleteComment}
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
        <p className="text-sm text-ink-2 whitespace-pre-wrap break-words mt-0.5">{c.body}</p>
        {c.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={c.imageUrl}
            alt=""
            loading="lazy"
            className="mt-2 max-h-64 max-w-full rounded-lg border border-line"
          />
        )}
        <div className="mt-1.5 flex items-center gap-3">
          {([1, -1] as const).map((v) => {
            const Icon = v === 1 ? ThumbsUp : ThumbsDown;
            const active = c.myVote === v;
            const count = v === 1 ? c.likes : c.dislikes;
            return signedIn ? (
              <button
                key={v}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await voteComment({ commentId: c.id, value: v });
                    if (!r.ok) toast.error(r.error);
                    else refresh();
                  })
                }
                className={`inline-flex items-center gap-1 text-[12px] font-medium cursor-pointer transition-colors ${
                  active ? (v === 1 ? "text-yes" : "text-no") : "text-faint hover:text-ink"
                }`}
              >
                <Icon className="size-3.5" />
                {count}
              </button>
            ) : (
              <span key={v} className="inline-flex items-center gap-1 text-[12px] font-medium text-faint">
                <Icon className="size-3.5" />
                {count}
              </span>
            );
          })}
          {replySlot && (
            <button
              onClick={() => setReplying((v) => !v)}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-faint hover:text-ink cursor-pointer transition-colors"
            >
              <Reply className="size-3.5" />
              {t.reply}
            </button>
          )}
        </div>
        {replying && replySlot && (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!replyText.trim()) return;
              start(async () => {
                const ok = await replySlot(replyText);
                if (ok) {
                  setReplyText("");
                  setReplying(false);
                }
              });
            }}
          >
            <Textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={t.replyPh}
              maxLength={1000}
              className="min-h-10 text-[13px]"
              autoFocus
            />
            <Button size="sm" disabled={pending || !replyText.trim()} className="self-end">
              {pending ? t.posting : t.reply}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
