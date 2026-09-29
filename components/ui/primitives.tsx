import * as React from "react";
import { cn } from "@/lib/utils";

// Minimal shadcn-style primitives — monochrome variant of the usual palette.

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost" | "yes" | "no" | "soft";
  size?: "sm" | "md" | "lg" | "xs";
};

export function Button({ className, variant = "primary", size = "md", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 font-semibold rounded-lg transition-all duration-150 cursor-pointer select-none",
        "active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none disabled:active:scale-100",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        size === "xs" && "h-7 px-2.5 text-xs",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-9.5 px-4 text-sm",
        size === "lg" && "h-11 px-5 text-[15px]",
        variant === "primary" && "bg-ink text-white hover:bg-ink-2",
        variant === "outline" && "border border-line bg-surface text-ink hover:bg-surface-2",
        variant === "ghost" && "text-mute hover:bg-surface-2 hover:text-ink",
        variant === "yes" && "bg-yes text-white hover:bg-yes-strong",
        variant === "no" && "bg-no text-white hover:bg-no-strong",
        variant === "soft" && "bg-surface-2 text-ink hover:bg-surface-3",
        className
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-[14px] border border-line bg-surface shadow-[0_1px_2px_rgba(16,16,20,0.04)]", className)}
      {...props}
    />
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink",
          "placeholder:text-faint focus:outline-2 focus:outline-ink focus:outline-offset-0 focus:border-ink",
          className
        )}
        {...props}
      />
    );
  }
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink min-h-24",
          "placeholder:text-faint focus:outline-2 focus:outline-ink focus:border-ink",
          className
        )}
        {...props}
      />
    );
  }
);

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink cursor-pointer",
        "focus:outline-2 focus:outline-ink",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Badge({
  className,
  tone = "mute",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "mute" | "yes" | "no" | "ink" | "warn" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        tone === "mute" && "bg-surface-3 text-mute",
        tone === "yes" && "bg-yes-soft text-yes-strong",
        tone === "no" && "bg-no-soft text-no-strong",
        tone === "ink" && "bg-ink text-white",
        tone === "warn" && "bg-amber-100 text-amber-800",
        className
      )}
      {...props}
    />
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      className={cn(
        "grid place-items-center size-8 rounded-full bg-ink text-white text-[11px] font-bold shrink-0",
        className
      )}
    >
      {initials || "?"}
    </div>
  );
}

// Segmented control used for Buy/Sell and Yes/No toggles — Radix-free, a11y via buttons.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string; tone?: "yes" | "no" | "ink" }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-surface-2 p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "h-8 rounded-md text-[13px] font-semibold transition-colors cursor-pointer",
              active
                ? o.tone === "yes"
                  ? "bg-yes text-white"
                  : o.tone === "no"
                    ? "bg-no text-white"
                    : "bg-ink text-white"
                : "text-mute hover:text-ink"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
