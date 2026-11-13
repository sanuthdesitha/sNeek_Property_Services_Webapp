"use client";

/**
 * PhoneFold (board "Admin phone", 2026-11): folds a card's body behind a
 * labelled disclosure on a phone only (below 640px).
 *
 * From 640px up, and on the first paint everywhere, it renders its children
 * exactly as given (no wrapper), so desktop markup does not change. Once the
 * viewport is known to be a phone it draws one 44px "Show details" button
 * (aria-expanded) and keeps the body mounted but hidden while folded, so a
 * draft typed inside survives folding.
 */
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsPhone } from "@/components/v2/ui/use-phone";

export type PhoneFoldProps = {
  /** Start folded on a phone. Default true. */
  folded?: boolean;
  /** Button text while folded, e.g. "Show details". */
  showLabel?: string;
  /** Button text while open. */
  hideLabel?: string;
  /** What the button folds, for its accessible name ("Money details"). */
  label?: string;
  className?: string;
  children: React.ReactNode;
};

export function PhoneFold({ folded = true, showLabel = "Show details", hideLabel = "Hide details", label, className, children }: PhoneFoldProps) {
  const phone = useIsPhone();
  const [open, setOpen] = React.useState(!folded);
  const regionId = React.useId();

  // A link to something inside (e.g. "#billing", "#dispatch-change") opens the fold first.
  React.useEffect(() => {
    if (!phone) return;
    const openForHash = () => {
      const id = window.location.hash.slice(1);
      if (!id) return;
      const region = document.getElementById(regionId);
      const target = document.getElementById(decodeURIComponent(id));
      if (!region || !target || !region.contains(target)) return;
      setOpen(true);
      window.requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
    };
    openForHash();
    window.addEventListener("hashchange", openForHash);
    return () => window.removeEventListener("hashchange", openForHash);
  }, [phone, regionId]);

  if (!phone) return <>{children}</>;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        aria-label={label ? `${open ? hideLabel : showLabel}: ${label}` : undefined}
        onClick={() => setOpen((value) => !value)}
        data-phone-fold=""
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-[var(--e-radius)] text-left text-[0.8125rem] font-[550] text-[hsl(var(--e-accent-portal))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
      >
        <span>{open ? hideLabel : showLabel}</span>
        <ChevronDown aria-hidden className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      <div id={regionId} hidden={!open} className={cn("flex min-w-0 flex-col gap-2", className)}>
        {children}
      </div>
    </>
  );
}
