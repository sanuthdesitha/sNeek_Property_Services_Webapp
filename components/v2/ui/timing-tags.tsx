/**
 * Guest-timing tags (late checkout, early check-in, same-day check-in), one
 * presentational component so the wording and tone are identical on every
 * office screen: Jobs rows, phone cards and board cards, the job page, the
 * job preview, the calendar and Command.
 *
 * Pure props, no "use client": server and client components both render it.
 * The tags come from `timingTagsFor` (lib/jobs/timing-tags.ts); this file only
 * draws them. Labels wrap rather than truncate so a 390px row never scrolls
 * sideways and never cuts the time off.
 */
import { EBadge } from "@/components/v2/ui/primitives";
import { cn } from "@/lib/utils";
import type { TimingTag } from "@/lib/jobs/timing-tags";
import type { TourTargetProps } from "@/lib/tutorials/targets";

export type TimingTagsProps = {
  tags: TimingTag[];
  className?: string;
  /** Smaller text for dense places (board cards, calendar detail). */
  size?: "sm" | "md";
} & Partial<TourTargetProps>;

export function TimingTags({ tags, className, size = "md", ...tour }: TimingTagsProps) {
  if (tags.length === 0) return null;
  return (
    <span {...tour} role="list" aria-label="Guest timing" className={cn("inline-flex min-w-0 max-w-full flex-wrap gap-1", className)}>
      {tags.map((tag) => (
        <span key={tag.key} role="listitem" className="inline-flex min-w-0 max-w-full">
          <EBadge
            tone={tag.tone}
            soft
            className={cn(
              "min-w-0 max-w-full whitespace-normal text-left font-[600] leading-snug [overflow-wrap:anywhere]",
              size === "sm" ? "text-[0.6875rem]" : "text-[0.75rem]",
            )}
          >
            {tag.label}
          </EBadge>
        </span>
      ))}
    </span>
  );
}
