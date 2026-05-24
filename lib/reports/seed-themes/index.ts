export { compactTheme } from "./compact";
export { magazineTheme } from "./magazine";
export { detailedTheme } from "./detailed";
export type { ReportThemeSeed, ReportThemeLayout } from "./types";

import { compactTheme } from "./compact";
import { magazineTheme } from "./magazine";
import { detailedTheme } from "./detailed";

export const SEED_REPORT_THEMES = [compactTheme, magazineTheme, detailedTheme];
