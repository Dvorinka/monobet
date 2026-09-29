"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Globe } from "lucide-react";
import { getT, isLang, LANG_COOKIE, LANGS, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function readLang(): Lang {
  const m = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`));
  return isLang(m?.[1]) ? m[1] : "en";
}

const noop = () => () => {};

export function LangToggle() {
  const router = useRouter();
  const lang = useSyncExternalStore(noop, readLang, () => "en" as Lang);
  const t = getT(lang);

  return (
    <div
      className="inline-flex items-center gap-0.5 h-9 rounded-full border border-line bg-surface p-0.5"
      role="group"
      aria-label={t.language}
      title={t.language}
    >
      <Globe className="size-3.5 text-faint ml-1.5 mr-0.5" aria-hidden />
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => {
            document.cookie = `${LANG_COOKIE}=${l};path=/;max-age=31536000;SameSite=Lax`;
            router.refresh();
          }}
          className={cn(
            "h-7 px-2 rounded-full text-[11px] font-bold uppercase tracking-wide cursor-pointer transition-colors",
            lang === l ? "bg-brand text-brand-on" : "text-mute hover:text-ink"
          )}
        >
          {l === "cs" ? "CZ" : "EN"}
        </button>
      ))}
    </div>
  );
}
