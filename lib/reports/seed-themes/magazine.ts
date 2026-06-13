import type { ReportThemeSeed } from "./types";

export const magazineTheme: ReportThemeSeed = {
  name: "Magazine",
  kind: "MAGAZINE",
  isDefault: false,
  layout: {
    sections: [
      { id: "header", visible: true, order: 0, options: { fullBleed: true } },
      { id: "before-after-gallery", visible: true, order: 1, options: { columns: 2, hero: true } },
      { id: "summary", visible: true, order: 2 },
      { id: "task-checklist", visible: true, order: 3 },
      { id: "qa-summary", visible: true, order: 4 },
      { id: "supplies", visible: false, order: 5 },
      { id: "signature", visible: true, order: 6 },
      { id: "footer", visible: true, order: 7 },
    ],
    photoSize: "hero",
    density: "comfortable",
  },
  titleTemplate: "{{property.name}} — {{job.scheduledFor | date short}}",
};
