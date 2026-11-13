"use client";

/**
 * PhoneCarousel (board "Admin phone", 2026-11): on a phone only, puts a row
 * (a stage bar) in a deliberate sideways carousel and scrolls it so the
 * current item is in view. From 640px up, and on the first paint, it renders
 * its children exactly as given, without a wrapper.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { useIsPhone } from "@/components/v2/ui/use-phone";

export type PhoneCarouselProps = {
  /** Accessible name of the scroll region, e.g. "Job progress, swipe for more". */
  label: string;
  /** CSS selector of the item to start on. Default: the current step. */
  currentSelector?: string;
  className?: string;
  children: React.ReactNode;
};

export function PhoneCarousel({ label, currentSelector = '[aria-current="step"]', className, children }: PhoneCarouselProps) {
  const phone = useIsPhone();
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!phone) return;
    const box = ref.current;
    const current = box?.querySelector<HTMLElement>(currentSelector);
    if (!box || !current) return;
    box.scrollLeft = Math.max(0, current.offsetLeft - 16);
  }, [phone, currentSelector]);

  if (!phone) return <>{children}</>;
  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      data-phone-carousel=""
      className={cn("-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
    >
      {children}
    </div>
  );
}
