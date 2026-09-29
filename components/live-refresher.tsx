"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Polls router.refresh() so server-rendered prices, charts, and activity stay
// live without a websocket. Skips while the tab is hidden and refreshes the
// moment it becomes visible again.
export function LiveRefresher({ intervalMs = 15000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, intervalMs);
    const onVisible = () => {
      if (!document.hidden) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);

  return null;
}
