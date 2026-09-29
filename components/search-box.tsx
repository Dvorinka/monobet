"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

export function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q") ?? "";

  return (
    <form
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        const input = e.currentTarget.querySelector("input")!;
        const sp = new URLSearchParams(params.toString());
        if (input.value.trim()) sp.set("q", input.value.trim());
        else sp.delete("q");
        router.push(`/?${sp.toString()}`);
      }}
    >
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-faint pointer-events-none" />
      <input
        key={q}
        defaultValue={q}
        placeholder="Search markets"
        className="h-9 w-full rounded-full border border-transparent bg-surface-2 pl-9 pr-3 text-sm text-ink placeholder:text-faint transition-all focus:bg-surface focus:border-brand/40 focus:ring-2 focus:ring-brand/20 focus:outline-none"
      />
    </form>
  );
}
