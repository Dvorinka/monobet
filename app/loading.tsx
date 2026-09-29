export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-10">
      <div className="h-6 w-40 rounded bg-surface-3 animate-pulse" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-44 rounded-[14px] border border-line bg-surface-2 animate-pulse" />
        ))}
      </div>
    </div>
  );
}
