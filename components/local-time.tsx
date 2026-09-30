"use client";

import { fmtDateTime } from "@/lib/money";
import type { Lang } from "@/lib/i18n";

// Schedule instants rendered in the viewer's timezone. SSR prints the
// server's zone; hydration corrects to local — the warning is intentional,
// the alternative is stamping everyone's deadlines in UTC.
export function LocalTime({
  d,
  lang,
  className,
}: {
  d: Date | string;
  lang?: Lang;
  className?: string;
}) {
  return (
    <span suppressHydrationWarning className={className}>
      {fmtDateTime(d, lang)}
    </span>
  );
}
