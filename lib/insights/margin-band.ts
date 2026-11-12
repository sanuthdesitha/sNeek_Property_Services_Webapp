/**
 * The property margin badge's tone, as drawn on the Business tab (7% danger,
 * 24% warning, 39% neutral, 48% success). Presentation only: the badge always
 * shows the number, so the tone is never the only signal, and the low-margin
 * finding keeps its own floor (LOW_MARGIN_MAX_PCT), which is also the top of
 * the danger band so the two never disagree.
 *
 * Bands, by gross margin percentage:
 *   danger   at or below MARGIN_DANGER_MAX_PCT
 *   warning  above that, below MARGIN_WARNING_BELOW_PCT
 *   neutral  from MARGIN_WARNING_BELOW_PCT, below MARGIN_SUCCESS_FROM_PCT
 *   success  at or above MARGIN_SUCCESS_FROM_PCT
 *
 * Pure.
 */
import { LOW_MARGIN_MAX_PCT } from "./findings";

export const MARGIN_DANGER_MAX_PCT = LOW_MARGIN_MAX_PCT;
export const MARGIN_WARNING_BELOW_PCT = 30;
export const MARGIN_SUCCESS_FROM_PCT = 45;

export type MarginBand = "danger" | "warning" | "neutral" | "success";

export function marginBand(marginPct: number): MarginBand {
  if (marginPct <= MARGIN_DANGER_MAX_PCT) return "danger";
  if (marginPct < MARGIN_WARNING_BELOW_PCT) return "warning";
  if (marginPct >= MARGIN_SUCCESS_FROM_PCT) return "success";
  return "neutral";
}

export const MARGIN_BAND_LABEL: Record<MarginBand, string> = {
  danger: `at or below ${MARGIN_DANGER_MAX_PCT}%`,
  warning: `below ${MARGIN_WARNING_BELOW_PCT}%`,
  neutral: `${MARGIN_WARNING_BELOW_PCT}% to under ${MARGIN_SUCCESS_FROM_PCT}%`,
  success: `${MARGIN_SUCCESS_FROM_PCT}% or more`,
};
