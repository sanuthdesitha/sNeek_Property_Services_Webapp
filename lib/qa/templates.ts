import { JobType } from "@prisma/client";

export type QaTemplateField = {
  id: string;
  label: string;
  type: "rating" | "textarea" | "checkbox" | "upload";
  required?: boolean;
  weight?: number;
  max?: number;
};

export type QaTemplateSection = {
  id: string;
  label: string;
  fields: QaTemplateField[];
};

export type QaTemplateSchema = {
  version: 1;
  sections: QaTemplateSection[];
};

const TYPE_LABELS: Record<JobType, string> = {
  AIRBNB_TURNOVER: "Airbnb turnover",
  DEEP_CLEAN: "Deep clean",
  END_OF_LEASE: "End of lease",
  GENERAL_CLEAN: "General clean",
  POST_CONSTRUCTION: "Post construction",
  PRESSURE_WASH: "Pressure wash",
  WINDOW_CLEAN: "Window clean",
  LAWN_MOWING: "Lawn mowing",
  SPECIAL_CLEAN: "Special clean",
  COMMERCIAL_RECURRING: "Commercial recurring",
  CARPET_STEAM_CLEAN: "Carpet steam clean",
  MOLD_TREATMENT: "Mould treatment",
  UPHOLSTERY_CLEANING: "Upholstery cleaning",
  TILE_GROUT_CLEANING: "Tile and grout cleaning",
  GUTTER_CLEANING: "Gutter cleaning",
  SPRING_CLEANING: "Spring cleaning",
};

export function jobTypeLabel(type: JobType) {
  return TYPE_LABELS[type] ?? String(type).replace(/_/g, " ");
}

export function buildDefaultQaTemplateSchema(jobType: JobType): QaTemplateSchema {
  const label = jobTypeLabel(jobType);
  return {
    version: 1,
    sections: [
      {
        id: "overall",
        label: `${label} quality`,
        fields: [
          { id: "overall_finish", label: "Overall finish", type: "rating", required: true, weight: 2, max: 5 },
          { id: "task_completion", label: "Required tasks completed", type: "rating", required: true, weight: 2, max: 5 },
          { id: "attention_items", label: "High-priority/admin/client requests handled", type: "rating", required: true, weight: 2, max: 5 },
          { id: "qa_notes", label: "QA notes", type: "textarea" },
        ],
      },
      {
        id: "presentation",
        label: "Presentation and evidence",
        fields: [
          { id: "photo_quality", label: "Cleaner photo evidence quality", type: "rating", required: true, weight: 1, max: 5 },
          { id: "guest_ready", label: "Guest/client-ready presentation", type: "rating", required: true, weight: 2, max: 5 },
          { id: "issues_found", label: "Issues found during QA", type: "textarea" },
          { id: "qa_photos", label: "QA photos", type: "upload" },
        ],
      },
      {
        id: "outcome",
        label: "Outcome",
        fields: [
          { id: "rework_required", label: "Rework required", type: "checkbox" },
          { id: "client_visible_summary", label: "Client-visible summary", type: "textarea" },
        ],
      },
    ],
  };
}

export function scoreQaSubmission(schema: QaTemplateSchema, data: Record<string, unknown>) {
  let weightedTotal = 0;
  let weightTotal = 0;
  const categoryScores: Record<string, number> = {};

  for (const section of schema.sections ?? []) {
    let sectionTotal = 0;
    let sectionWeight = 0;
    for (const field of section.fields ?? []) {
      if (field.type !== "rating") continue;
      const max = Number(field.max ?? 5) || 5;
      const weight = Number(field.weight ?? 1) || 1;
      const raw = Number(data[field.id] ?? 0);
      const value = Number.isFinite(raw) ? Math.max(0, Math.min(max, raw)) : 0;
      const score = (value / max) * 100;
      weightedTotal += score * weight;
      weightTotal += weight;
      sectionTotal += score * weight;
      sectionWeight += weight;
    }
    if (sectionWeight > 0) {
      categoryScores[section.id] = Math.round(sectionTotal / sectionWeight);
    }
  }

  const score = weightTotal > 0 ? Math.round(weightedTotal / weightTotal) : 100;
  const reworkRequired = data.rework_required === true;
  return { score, categoryScores, passed: score >= 80 && !reworkRequired };
}
