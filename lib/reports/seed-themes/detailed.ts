import type { ReportThemeSeed } from "./types";

export const detailedTheme: ReportThemeSeed = {
  name: "Detailed",
  kind: "DETAILED",
  isDefault: false,
  layout: {
    sections: [
      { id: "header", visible: true, order: 0 },
      { id: "summary", visible: true, order: 1 },
      { id: "task-checklist", visible: true, order: 2, options: { showTimings: true } },
      { id: "supplies", visible: true, order: 3 },
      { id: "before-after-gallery", visible: true, order: 4, options: { columns: 2 } },
      { id: "signature", visible: true, order: 5 },
      { id: "footer", visible: true, order: 6 },
    ],
    photoSize: "medium",
    density: "default",
  },
  titleTemplate: "Full Job Report — {{job.jobNumber}}",
};
