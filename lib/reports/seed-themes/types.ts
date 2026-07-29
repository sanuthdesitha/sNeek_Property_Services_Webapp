export interface ReportThemeLayout {
  sections: Array<{
    id:
      | "header"
      | "summary"
      | "before-after-gallery"
      | "task-checklist"
      | "qa-summary"
      | "supplies"
      | "signature"
      | "footer";
    visible: boolean;
    order: number;
    options?: Record<string, any>;
  }>;
  photoSize: "small" | "medium" | "large" | "hero";
  density: "compact" | "default" | "comfortable";
  /** Visual skin: "classic" | "luxury" | "estate" (the modern default). */
  template?: "classic" | "luxury" | "estate";
}

export interface ReportThemeSeed {
  name: string;
  kind: "COMPACT" | "MAGAZINE" | "DETAILED" | "CUSTOM";
  isDefault: boolean;
  layout: ReportThemeLayout;
  primaryColorHsl?: string;
  accentColorHsl?: string;
  titleTemplate: string;
}
