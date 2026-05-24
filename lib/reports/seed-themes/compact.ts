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
      { id: "before-after-gallery", visible: true, order: 3, options: { columns: 3 } },
      { id: "supplies", visible: false, order: 4 },
      { id: "signature", visible: true, order: 5 },
      { id: "footer", visible: true, order: 6 },
    ],
    photoSize: "small",
    density: "compact",
  },
  titleTemplate: "Job Report — {{job.jobNumber}}",
};
