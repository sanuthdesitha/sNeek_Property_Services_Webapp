import type { ReportThemeSeed } from "./types";

/**
 * Luxury — the premium, magazine-grade report skin. Uses kind CUSTOM (no enum
 * migration needed) and layout.template = "luxury" to select the refined
 * renderer in lib/reports/generator.ts. Superseded as default by the Estate
 * theme; stays active + selectable for rollback.
 */
export const luxuryTheme: ReportThemeSeed = {
  name: "Luxury",
  kind: "CUSTOM",
  isDefault: false,
  layout: {
    template: "luxury",
    sections: [
      { id: "header", visible: true, order: 0, options: { fullBleed: true } },
      { id: "summary", visible: true, order: 1 },
      { id: "task-checklist", visible: true, order: 2 },
      { id: "qa-summary", visible: true, order: 3 },
      { id: "before-after-gallery", visible: true, order: 4, options: { columns: 2 } },
      { id: "supplies", visible: false, order: 5 },
      { id: "signature", visible: true, order: 6 },
      { id: "footer", visible: true, order: 7 },
    ],
    photoSize: "large",
    density: "comfortable",
  },
  // Brand-aligned deep slate + warm gold accent.
  primaryColorHsl: "215 35% 22%",
  accentColorHsl: "38 64% 50%",
  titleTemplate: "{{property.name}} — Service Report",
};
