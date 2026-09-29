import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// URL-safe label slug without the random suffix — used for ?opt= deep links.
export function slugifyLabel(s: string): string {
  const slug = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= 40) return slug || "opt";
  // Only cut at a word boundary when the slug was actually truncated.
  return slug.slice(0, 40).replace(/-[^-]*$/, "") || "opt";
}
