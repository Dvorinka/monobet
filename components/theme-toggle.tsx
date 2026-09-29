"use client";

import { useReducer, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

const KEY = "mm-theme";

const noop = () => () => {};
const isDark = () => document.documentElement.classList.contains("dark");

export function ThemeToggle() {
  const [, rerender] = useReducer((c: number) => c + 1, 0);
  const dark = useSyncExternalStore(noop, isDark, () => false);

  return (
    <button
      type="button"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={() => {
        const next = !isDark();
        document.documentElement.classList.toggle("dark", next);
        document.documentElement.style.colorScheme = next ? "dark" : "light";
        try {
          localStorage.setItem(KEY, next ? "dark" : "light");
        } catch {}
        rerender();
      }}
      className="grid place-items-center size-9 rounded-full border border-line bg-surface text-mute cursor-pointer transition-all duration-150 hover:text-ink hover:border-faint/60 active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-brand"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
