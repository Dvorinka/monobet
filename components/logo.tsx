import { cn } from "@/lib/utils";

// MonoMark glyph: an "M" drawn as a market price line, ending in the quote dot.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7 shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#141a16" />
      <path
        d="M7.5 21.5 L12 12 L16 18.5 L20 11.5"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="9.5" r="2.2" fill="var(--color-yes)" />
    </svg>
  );
}

export function LogoLockup({ className, wordmark = true }: { className?: string; wordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      {wordmark && <span className="font-bold text-[17px] tracking-tight hidden sm:block">MonoMark</span>}
    </span>
  );
}
