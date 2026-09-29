"use client";

import { Button } from "@/components/ui/primitives";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md px-4 pt-24 text-center">
      <h1 className="text-[20px] font-bold">Something went wrong</h1>
      <p className="text-sm text-mute mt-2">The market makers have been notified.</p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
