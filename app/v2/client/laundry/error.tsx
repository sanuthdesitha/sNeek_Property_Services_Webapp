"use client";

import { EButton } from "@/components/v2/ui/primitives";

export default function LaundryError({ reset }: { error: Error; reset: () => void }) {
  return <section role="alert" className="space-y-3 p-4">
    <h1 className="text-xl font-semibold">Laundry is unavailable</h1>
    <p>We could not load your laundry schedules. Please try again.</p>
    <EButton onClick={reset}>Retry</EButton>
  </section>;
}
