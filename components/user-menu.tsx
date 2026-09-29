"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";
import { Avatar } from "@/components/ui/primitives";
import { useEffect, useRef, useState } from "react";

export function UserMenu({
  name,
  username,
  role,
}: {
  name: string;
  username: string | null;
  role: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const item = "block px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-surface-2 rounded-md cursor-pointer";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-full ring-2 ring-transparent hover:ring-line transition cursor-pointer"
        aria-label="Account menu"
      >
        <Avatar name={username ?? name} />
      </button>
      {open && (
        <div className="absolute right-0 top-11 w-52 rounded-xl border border-line bg-surface shadow-lg p-1.5 z-50">
          <div className="px-3.5 py-2 border-b border-line-2 mb-1">
            <div className="text-sm font-semibold truncate">@{username ?? name}</div>
            <div className="text-xs text-mute">{role === "admin" ? "Admin" : "Trader"}</div>
          </div>
          <Link href="/portfolio" className={item} onClick={() => setOpen(false)}>
            Portfolio
          </Link>
          <Link href="/propose" className={item} onClick={() => setOpen(false)}>
            Propose market
          </Link>
          {role === "admin" && (
            <Link href="/admin" className={item} onClick={() => setOpen(false)}>
              Admin panel
            </Link>
          )}
          <button
            className={`${item} w-full text-left text-no-strong`}
            onClick={async () => {
              await signOut();
              setOpen(false);
              router.refresh();
              router.push("/");
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
