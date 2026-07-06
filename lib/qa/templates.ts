import { JobType } from "@prisma/client";
import { computeQaScore, PASS_THRESHOLD } from "@/lib/qa/scoring";

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
  version: number;
  sections: QaTemplateSection[];
};

/** Bump when the default template shape changes so auto-created "Default QA"
 *  templates regenerate to the latest area-based schema. */
export const QA_TEMPLATE_VERSION = 2;

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

/** Short helper: a 0–5 rating criterion (optional → blank means "not assessed"). */
function rating(id: string, label: string, weight = 1): QaTemplateField {
  return { id, label, type: "rating", weight, max: 5 };
}

/** Job types that are interior, room-by-room cleans (area-based scoring). */
const INTERIOR_TYPES = new Set<JobType>([
  JobType.AIRBNB_TURNOVER,
  JobType.DEEP_CLEAN,
  JobType.END_OF_LEASE,
  JobType.GENERAL_CLEAN,
  JobType.SPRING_CLEANING,
  JobType.SPECIAL_CLEAN,
  JobType.POST_CONSTRUCTION,
  JobType.COMMERCIAL_RECURRING,
]);

/** Per-area sections shared by every interior clean. Each area is scored on its
 *  own; criteria left blank are treated as "not applicable" by the scorer, so a
 *  property without (say) a bath simply doesn't drag the score down. */
function interiorAreaSections(): QaTemplateSection[] {
  return [
    {
      id: "kitchen",
      label: "Kitchen",
      fields: [
        rating("kitchen_benches", "Benches, splashback & surfaces"),
        rating("kitchen_appliances", "Appliances (oven, cooktop, microwave, fridge)"),
        rating("kitchen_sink", "Sink & tapware"),
        rating("kitchen_cupboards", "Cupboard fronts & handles"),
        rating("kitchen_floor", "Floor (swept & mopped)"),
      ],
    },
    {
      id: "bathrooms",
      label: "Bathrooms & laundry",
      fields: [
        rating("bath_toilet", "Toilet (bowl, seat, base)"),
        rating("bath_shower", "Shower, screen & taps"),
        rating("bath_basin", "Basin, vanity & mirror"),
        rating("bath_tiles", "Tiles & grout"),
        rating("bath_floor", "Floor & skirting"),
      ],
    },
    {
      id: "bedrooms",
      label: "Bedrooms",
      fields: [
        rating("bed_presentation", "Beds made / linen presentation", 2),
        rating("bed_surfaces", "Surfaces dusted (sides, sills, shelves)"),
        rating("bed_mirrors", "Mirrors & glass"),
        rating("bed_wardrobes", "Wardrobes & drawers"),
        rating("bed_floor", "Floor (vacuumed / mopped)"),
      ],
    },
    {
      id: "living",
      label: "Living & common areas",
      fields: [
        rating("living_surfaces", "Surfaces & dusting"),
        rating("living_windows", "Internal windows & glass"),
        rating("living_edges", "Skirting, edges & corners"),
        rating("living_floor", "Floors (vacuumed / mopped)"),
      ],
    },
  ];
}

/** Service-quality criteria for outdoor / specialty (non-room) job types. */
function specialtySection(label: string): QaTemplateSection {
  return {
    id: "workmanship",
    label: `${label} — workmanship`,
    fields: [
      rating("work_coverage", "Coverage & completeness", 2),
      rating("work_finish", "Finish quality / streak & residue free", 2),
      rating("work_detail", "Edges, corners & detail areas"),
      rating("work_safety", "Site left safe, tidy & undamaged"),
    ],
  };
}

/** Shared closing sections used by every template. */
function finishAndOutcomeSections(): QaTemplateSection[] {
  return [
    {
      id: "finish",
      label: "Whole-job finish & presentation",
      fields: [
        rating("finish_presentation", "Guest / client-ready presentation", 2),
        rating("finish_odour", "Odour & freshness"),
        rating("finish_bins", "Bins emptied & re-lined"),
        rating("finish_restock", "Restock & amenities set"),
        rating("finish_photos", "Cleaner photo evidence quality"),
        { id: "qa_photos", label: "QA photos", type: "upload" },
      ],
    },
    {
      id: "outcome",
      label: "Outcome",
      fields: [
        { id: "rework_required", label: "Rework required", type: "checkbox" },
        { id: "issues_found", label: "Issues found during QA", type: "textarea" },
        { id: "client_visible_summary", label: "Client-visible summary", type: "textarea" },
        { id: "qa_notes", label: "QA notes (internal)", type: "textarea" },
      ],
    },
  ];
}

export function buildDefaultQaTemplateSchema(jobType: JobType): QaTemplateSchema {
  const label = jobTypeLabel(jobType);
  const coreSections = INTERIOR_TYPES.has(jobType)
    ? interiorAreaSections()
    : [specialtySection(label)];
  return {
    version: QA_TEMPLATE_VERSION,
    sections: [...coreSections, ...finishAndOutcomeSections()],
  };
}

export function scoreQaSubmission(schema: QaTemplateSchema, data: Record<string, unknown>) {
  // Real (seeded/authored) QA templates use FormSchema fields — radio/select/
  // yesno/checkbox with a NESTED `scoring: { max, weight }` — and are scored by
  // the canonical engine in lib/qa/scoring.ts (Pass/Minor/Fail → 2/1/0). The
  // legacy math below only understands `type:"rating"` with top-level max, so
  // on a real template it found zero scorable fields and returned score 100 /
  // passed no matter what the inspector answered. Delegate whenever any field
  // carries nested scoring; keep the legacy path for the auto-generated
  // default template (buildDefaultQaTemplateSchema).
  const hasNestedScoring = (schema.sections ?? []).some((section) =>
    ((section.fields ?? []) as Array<Record<string, unknown>>).some(
      (field) =>
        field &&
        typeof field === "object" &&
        typeof (field as { scoring?: { max?: unknown } }).scoring?.max === "number"
    )
  );
  if (hasNestedScoring) {
    const result = computeQaScore(schema as never, data);
    const categoryScores: Record<string, number> = {};
    for (const s of result.sectionScores) categoryScores[s.sectionId] = s.percent;
    const reworkRequired = data.rework_required === true;
    return {
      score: result.percent,
      categoryScores,
      passed: result.percent >= PASS_THRESHOLD && !reworkRequired,
    };
  }

  let weightedTotal = 0;
  let weightTotal = 0;
  const categoryScores: Record<string, number> = {};

  for (const section of schema.sections ?? []) {
    let sectionTotal = 0;
    let sectionWeight = 0;
    for (const field of section.fields ?? []) {
      if (field.type !== "rating") continue;
      const rawVal = data[field.id];
      // Blank = "not assessed / not applicable" — exclude from the score entirely
      // so area-based templates aren't penalised for areas that don't apply.
      if (rawVal === undefined || rawVal === null || rawVal === "") continue;
      const raw = Number(rawVal);
      if (!Number.isFinite(raw)) continue;
      const max = Number(field.max ?? 5) || 5;
      const weight = Number(field.weight ?? 1) || 1;
      const value = Math.max(0, Math.min(max, raw));
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
