"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { getT, isLang, LANG_COOKIE, LANGS, type Lang } from "@/lib/i18n";

function readLang(): Lang {
  const m = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`));
  return isLang(m?.[1]) ? m[1] : "en";
}

const noop = () => () => {};

// Single compact button — cycles the language list instead of rendering a pill
// per option, since there's only ever two.
export function LangToggle() {
  const router = useRouter();
  const lang = useSyncExternalStore(noop, readLang, () => "en" as Lang);
  const t = getT(lang);
  const next = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];

  return (
    <button
      type="button"
      aria-label={t.language}
      title={t.language}
      onClick={() => {
        document.cookie = `${LANG_COOKIE}=${next};path=/;max-age=31536000;SameSite=Lax`;
        router.refresh();
      }}
      className="size-9 grid place-items-center rounded-lg text-[11px] font-bold uppercase tracking-wide text-mute hover:text-ink hover:bg-surface-2 transition cursor-pointer"
    >
      {lang === "cs" ? "CZ" : "EN"}
    </button>
  );
}
