import type { ReportThemeSeed } from "./types";

export const compactTheme: ReportThemeSeed = {
  name: "Compact",
  kind: "COMPACT",
  isDefault: false,
  layout: {
    sections: [
      { id: "header", visible: true, order: 0 },
      { id: "summary", visible: true, order: 1 },
      { id: "task-checklist", visible: true, order: 2 },
      { id: "qa-summary", visible: true, order: 3 },
      { id: "before-after-gallery", visible: true, order: 4, options: { columns: 3 } },
      { id: "supplies", visible: false, order: 5 },
      { id: "signature", visible: true, order: 6 },
      { id: "footer", visible: true, order: 7 },
    ],
    photoSize: "small",
    density: "compact",
  },
  titleTemplate: "Job Report — {{job.jobNumber}}",
};
