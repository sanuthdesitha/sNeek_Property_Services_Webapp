export { compactTheme } from "./compact";
export { magazineTheme } from "./magazine";
export { detailedTheme } from "./detailed";
export { luxuryTheme } from "./luxury";
export type { ReportThemeSeed, ReportThemeLayout } from "./types";

import { compactTheme } from "./compact";
import { magazineTheme } from "./magazine";
import { detailedTheme } from "./detailed";
import { luxuryTheme } from "./luxury";

// Luxury is the default skin; Compact/Magazine/Detailed remain active and
// selectable (the preserved "old format" themes).
export const SEED_REPORT_THEMES = [luxuryTheme, compactTheme, magazineTheme, detailedTheme];
