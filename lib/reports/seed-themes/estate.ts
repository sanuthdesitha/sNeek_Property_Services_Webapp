import type { ReportThemeSeed } from "./types";

/**
 * Estate — the modern default report skin (layout.template = "estate",
 * rendered by lib/reports/estate-template.ts from the pure view model in
 * lib/reports/report-view-model.ts). Cover band, at-a-glance stat tiles,
 * faithful per-section checklist mirroring, captioned photo grids, extras
 * (laundry / supplies / rework / self-inspection) and the client-safe QA
 * summary. Kind CUSTOM — no enum migration needed. Luxury/Compact/Magazine/
 * Detailed stay active + selectable for rollback.
 */
export const estateTheme: ReportThemeSeed = {
  name: "Estate",
  kind: "CUSTOM",
  isDefault: true,
  layout: {
    template: "estate",
    sections: [
      { id: "header", visible: true, order: 0, options: { fullBleed: true } },
      { id: "summary", visible: true, order: 1 },
      { id: "task-checklist", visible: true, order: 2 },
      { id: "qa-summary", visible: true, order: 3 },
      { id: "before-after-gallery", visible: true, order: 4, options: { columns: 3 } },
      { id: "supplies", visible: true, order: 5 },
      { id: "signature", visible: true, order: 6 },
      { id: "footer", visible: true, order: 7 },
    ],
    photoSize: "medium",
    density: "default",
  },
  // Deep estate navy + warm gold accent (matches the v2 Estate brand direction).
  primaryColorHsl: "215 45% 18%",
  accentColorHsl: "38 64% 50%",
  titleTemplate: "{{property.name}} — Service Report",
};
