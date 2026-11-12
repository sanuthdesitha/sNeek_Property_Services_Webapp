/**
 * Live margin check on the quote page: the margin-floor model the quote
 * routes and the pipeline already use (`estimateMargin`), fed with the
 * builder's lines. The server passes only the cost share and the floor (not
 * the PIN-protected rack rate or cleaner cost). Unknown stays unknown.
 */
import { estimateMargin } from "@/lib/quotes/pipeline-types";
import type { LineItem } from "./model";

export type MarginModel = { costShare: number; floorPercent: number } | null;

export type MarginCheck =
  | { state: "unknown"; label: string }
  | { state: "ok"; label: string; margin: number }
  | { state: "below"; label: string; margin: number };

export function liveMarginCheck(model: MarginModel, lines: LineItem[], netSubtotal: number): MarginCheck {
  if (!model) return { state: "unknown", label: "Margin unknown (rate card not set)" };
  const positiveSubtotal = lines.reduce((sum, line) => sum + Math.max(0, Number(line.total) || 0), 0);
  const { margin, belowFloor } = estimateMargin({
    positiveSubtotal,
    netSubtotal,
    rackHourlyRate: 1,
    cleanerHourlyCost: model.costShare,
    marginFloorPercent: model.floorPercent,
  });
  if (margin == null) return { state: "unknown", label: "Margin unknown until priced" };
  const percent = `${(margin * 100).toFixed(0)}%`;
  return belowFloor
    ? { state: "below", label: `Margin warning: ${percent}, below the ${model.floorPercent}% floor`, margin }
    : { state: "ok", label: "No margin warning", margin };
}
