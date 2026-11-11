/**
 * Eight-week score sparkline (the concept's `.spark`). Each bar is one Sydney
 * week's average authoritative score; a week without a reviewed clean is a
 * short dashed stub, never a zero-height "0". The bars turn amber when the
 * latest four weeks average below the four before (a display cue only). The
 * figures are spelled out for screen readers.
 */
import type { TrendPoint } from "@/lib/quality/cleans";
import { shortDayLabel } from "@/lib/quality/period";

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function isDeclining(points: TrendPoint[]): boolean {
  const scores = points.map((point) => point.avgScore);
  const early = mean(scores.slice(0, 4).filter((s): s is number => s !== null));
  const late = mean(scores.slice(4).filter((s): s is number => s !== null));
  return early !== null && late !== null && late < early;
}

export function Sparkline({ points, name }: { points: TrendPoint[]; name: string }) {
  const withData = points.filter((point) => point.avgScore !== null);
  const declining = isDeclining(points);
  const description = withData.length
    ? `${name}, weekly average score: ${points
        .map((point) => `week of ${shortDayLabel(point.weekStart)} ${point.avgScore === null ? "no reviews" : Math.round(point.avgScore)}`)
        .join(", ")}`
    : `${name}: no reviewed cleans in the last 8 weeks`;

  if (withData.length === 0) {
    return <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No reviews</span>;
  }

  return (
    <span role="img" aria-label={description} className="flex h-[22px] items-end gap-[2px]">
      {points.map((point) =>
        point.avgScore === null ? (
          <i key={point.weekStart} className="block h-[3px] w-[5px] rounded-[1px] border-t border-dashed border-[hsl(var(--e-border-strong))]" />
        ) : (
          <i
            key={point.weekStart}
            className={declining ? "block w-[5px] rounded-[1px] bg-[hsl(var(--e-warning))]" : "block w-[5px] rounded-[1px] bg-[hsl(var(--e-primary))]"}
            style={{ height: `${Math.max(8, Math.min(100, point.avgScore))}%` }}
          />
        ),
      )}
    </span>
  );
}
