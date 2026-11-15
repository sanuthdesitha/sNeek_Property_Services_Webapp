"use client";

/**
 * A photo tile on the inspection record: the photo with a caption on a dark
 * strip, a pulsing tile while its link loads, and "Photo unavailable" once the
 * access rail refused or failed (never a blank as if there were no photo).
 */
import { cn } from "@/lib/utils";

const SIZE = {
  md: "h-[4.5rem] w-[5.5rem]",
  lg: "h-24 w-32 max-sm:h-20 max-sm:w-28",
} as const;

export function RecordThumb({
  url,
  label,
  alt,
  size = "md",
}: {
  /** undefined = loading; null = unavailable. */
  url: string | null | undefined;
  label?: string;
  alt: string;
  size?: keyof typeof SIZE;
}) {
  const frame = cn("relative shrink-0 overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted))]", SIZE[size]);
  if (url === null) {
    return (
      <div role="img" aria-label={`${alt}: photo unavailable`} className={cn(frame, "flex items-center justify-center border-dashed p-1 text-center text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]")}>
        Photo unavailable
      </div>
    );
  }
  const caption = label ? (
    <span className="absolute inset-x-1 bottom-1 truncate rounded-[4px] bg-[hsl(160_18%_10%/0.78)] px-1.5 py-px text-[0.625rem] font-[600] text-white">{label}</span>
  ) : null;
  if (!url) {
    return (
      <div role="img" aria-label={`${alt}: loading`} className={cn(frame, "animate-pulse")}>
        {caption}
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className={cn(frame, "block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]")} aria-label={`${alt} (opens the photo)`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="h-full w-full object-cover" />
      {caption}
    </a>
  );
}
