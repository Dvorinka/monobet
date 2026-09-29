// Shared option styling — deterministic color per option index so a row, its
// chip, and its chart line always match. Client-safe.

export const OPTION_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#8b5cf6", // violet
  "#f59e0b", // amber
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#22c55e", // green
  "#f97316", // orange
  "#6366f1", // indigo
  "#14b8a6", // teal
  "#eab308", // yellow
  "#64748b", // slate
] as const;

export function optionColor(index: number): string {
  return OPTION_COLORS[((index % OPTION_COLORS.length) + OPTION_COLORS.length) % OPTION_COLORS.length];
}

export function optionSoftBg(color: string): string {
  return `color-mix(in srgb, ${color} 14%, transparent)`;
}
