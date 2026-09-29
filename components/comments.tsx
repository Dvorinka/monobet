"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Avatar, Button, Textarea } from "@/components/ui/primitives";
import { addComment, deleteComment } from "@/lib/actions";
import { timeAgo } from "@/lib/money";
import { Trash2 } from "lucide-react";

export type CommentRow = {
  id: string;
  body: string;
  createdAt: Date;
  userId: string;
  username: string | null;
  name: string;
};

export function Comments({
  marketId,
  comments,
  signedIn,
  currentUserId,
  isAdmin,
}: {
  marketId: string;
  comments: CommentRow[];
  signedIn: boolean;
  currentUserId?: string;
  isAdmin?: boolean;
}) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div>
      {signedIn ? (
        <form
          className="flex gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            start(async () => {
              const r = await addComment({ marketId, body });
              if (r.ok) {
                setBody("");
                router.refresh();
              } else toast.error(r.error);
            });
          }}
        >
          <Avatar name="you" className="size-8 mt-1" />
          <div className="flex-1">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Add a comment"
              maxLength={1000}
              className="min-h-16"
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" disabled={pending || !body.trim()}>
                {pending ? "Posting…" : "Comment"}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <p className="text-[13px] text-mute">
          <Link href="/login" className="text-ink font-semibold underline underline-offset-2">
            Log in
          </Link>{" "}
          to comment.
        </p>
      )}

      <div className="mt-6 space-y-5">
        {comments.length === 0 && <p className="text-[13px] text-faint">No comments yet.</p>}
        {comments.map((c) => (
          <div key={c.id} className="flex gap-3 group anim-rise">
            <Avatar name={c.username ?? c.name} className="size-8" />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-semibold">@{c.username ?? c.name}</span>
                <span className="text-[11px] text-faint">{timeAgo(c.createdAt)}</span>
                {(currentUserId === c.userId || isAdmin) && (
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-faint hover:text-no cursor-pointer"
                    onClick={() =>
                      start(async () => {
                        const r = await deleteComment(c.id);
                        if (r.ok) router.refresh();
                        else toast.error(r.error);
                      })
                    }
                    aria-label="Delete comment"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              <p className="text-sm text-ink-2 whitespace-pre-wrap break-words mt-0.5">{c.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
