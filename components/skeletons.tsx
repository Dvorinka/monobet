import { cn } from "@/lib/utils";

export function Sk({ className }: { className?: string }) {
  return <div className={cn("anim-shimmer rounded-md bg-surface-3", className)} />;
}

export function MarketCardSkeleton() {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-4">
      <div className="flex gap-3">
        <Sk className="size-10 rounded-lg" />
        <div className="flex-1 space-y-2 py-0.5">
          <Sk className="h-3.5 w-full" />
          <Sk className="h-3.5 w-3/4" />
        </div>
        <Sk className="h-7 w-[72px]" />
      </div>
      <Sk className="mt-4 h-7 w-20" />
      <Sk className="mt-2 h-3 w-16" />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Sk className="h-8.5" />
        <Sk className="h-8.5" />
      </div>
      <Sk className="mt-3 h-3 w-1/2" />
    </div>
  );
}

export function MarketGridSkeleton({ n = 6 }: { n?: number }) {
  return (
    <div className="mx-auto max-w-6xl px-4">
      <Sk className="mt-6 h-6 w-44" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 pb-10">
        {Array.from({ length: n }).map((_, i) => (
          <MarketCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export function MarketPageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-5">
      <Sk className="h-4 w-40" />
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_340px]">
        <div>
          <Sk className="h-8 w-3/4" />
          <Sk className="mt-3 h-4 w-1/2" />
          <Sk className="mt-8 h-9 w-24" />
          <Sk className="mt-4 h-[300px] w-full rounded-[14px]" />
          <Sk className="mt-8 h-5 w-40" />
          <Sk className="mt-3 h-24 w-full" />
        </div>
        <div className="space-y-4">
          <Sk className="h-64 w-full rounded-[14px]" />
          <Sk className="h-28 w-full rounded-[14px]" />
        </div>
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 space-y-4">
      <Sk className="h-7 w-52" />
      <Sk className="h-4 w-72" />
      <Sk className="h-64 w-full rounded-[14px]" />
    </div>
  );
}
