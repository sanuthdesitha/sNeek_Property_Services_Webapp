export { compactTheme } from "./compact";
export { magazineTheme } from "./magazine";
export { detailedTheme } from "./detailed";
export { luxuryTheme } from "./luxury";
export { estateTheme } from "./estate";
export type { ReportThemeSeed, ReportThemeLayout } from "./types";

import { compactTheme } from "./compact";
import { magazineTheme } from "./magazine";
import { detailedTheme } from "./detailed";
import { luxuryTheme } from "./luxury";
import { estateTheme } from "./estate";

// Estate is the default skin; Luxury/Compact/Magazine/Detailed remain active
// and selectable (the preserved older formats, kept for rollback).
export const SEED_REPORT_THEMES = [estateTheme, luxuryTheme, compactTheme, magazineTheme, detailedTheme];
