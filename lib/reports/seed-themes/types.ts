export interface ReportThemeLayout {
  sections: Array<{
    id: "header" | "summary" | "before-after-gallery" | "task-checklist" | "supplies" | "signature" | "footer";
    visible: boolean;
    order: number;
    options?: Record<string, any>;
  }>;
  photoSize: "small" | "medium" | "large" | "hero";
  density: "compact" | "default" | "comfortable";
}

export interface ReportThemeSeed {
  name: string;
  kind: "COMPACT" | "MAGAZINE" | "DETAILED";
  isDefault: boolean;
  layout: ReportThemeLayout;
  primaryColorHsl?: string;
  accentColorHsl?: string;
  titleTemplate: string;
}
