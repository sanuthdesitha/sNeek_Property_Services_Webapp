/**
 * QA inspection form template library.
 *
 * 10 templates, one per V1 FormKind / cleaner-form job type. Each template
 * shares the same shape (Pass/Minor/Fail radios + photo evidence + notes
 * sections, with a final Overall section) so the QA portal renderer can
 * handle them uniformly.
 *
 * Scoring contract lives in `lib/qa/scoring.ts`.
 */
import { qaAirbnbTurnoverTemplate } from "./airbnb-turnover";
import { qaEndOfLeaseTemplate } from "./end-of-lease";
import { qaDeepCleanTemplate } from "./deep-clean";
import { qaRegularMaintenanceTemplate } from "./regular-maintenance";
import { qaPostConstructionTemplate } from "./post-construction";
import { qaWindowTemplate } from "./window";
import { qaCarpetTemplate } from "./carpet";
import { qaCommercialTemplate } from "./commercial";
import { qaMoveInTemplate } from "./move-in";
import { qaOvenTemplate } from "./oven";

export { qaAirbnbTurnoverTemplate } from "./airbnb-turnover";
export { qaEndOfLeaseTemplate } from "./end-of-lease";
export { qaDeepCleanTemplate } from "./deep-clean";
export { qaRegularMaintenanceTemplate } from "./regular-maintenance";
export { qaPostConstructionTemplate } from "./post-construction";
export { qaWindowTemplate } from "./window";
export { qaCarpetTemplate } from "./carpet";
export { qaCommercialTemplate } from "./commercial";
export { qaMoveInTemplate } from "./move-in";
export { qaOvenTemplate } from "./oven";

export const ALL_QA_SEED_TEMPLATES = [
  qaAirbnbTurnoverTemplate,
  qaEndOfLeaseTemplate,
  qaDeepCleanTemplate,
  qaRegularMaintenanceTemplate,
  qaPostConstructionTemplate,
  qaWindowTemplate,
  qaCarpetTemplate,
  qaCommercialTemplate,
  qaMoveInTemplate,
  qaOvenTemplate,
];
