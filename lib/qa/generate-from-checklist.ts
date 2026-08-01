import type { FormSchema, FormSection, FormField } from "@/lib/forms/types";

/**
 * Generate a QA inspection template from the property's OWN cleaner checklist.
 *
 * Why derive rather than hand-author: the built-in default grades four generic
 * areas (kitchen / bathrooms / bedrooms / living), while a real turnover
 * checklist is far more specific. The live P11 airbnb checklist, for example,
 * has thirteen sections — two separate bathrooms, three separate bedrooms, a
 * balcony, arrival evidence, and a fifteen-item final inspection ending in
 * "empty the vacuum cleaner". An inspector grading that property against four
 * generic areas cannot fail the thing that actually went wrong, and the cleaner
 * cannot be told which item they missed.
 *
 * Deriving keeps the two in step for free: change the checklist and the QA form
 * follows, instead of drifting until someone notices.
 *
 * TWO RULES THAT LOOK COSMETIC AND ARE NOT:
 *
 *  1. SECTION TITLES ARE COPIED VERBATIM. `lib/qa/section-match.ts` pairs a QA
 *     section with the cleaner's section by normalised title containment, and
 *     that pairing is what puts the cleaner's own photos beside the inspector's
 *     grading. Rename a section here and the photo strip silently disappears —
 *     no error, just an inspector grading blind.
 *
 *  2. WE COLLAPSE, WE DO NOT MIRROR. One QA question per cleaner checkbox would
 *     turn P11's ~100 fields into ~100 verdicts. Nobody completes that honestly;
 *     they tap Pass down the list, which is worse than no inspection because it
 *     manufactures evidence of a check that never happened. Each section
 *     collapses to a handful of outcomes covering what that section is FOR.
 */

/** Buckets a section's fields collapse into, matched by keyword. Order matters:
 *  the first bucket whose pattern hits claims the field. */
const OUTCOME_BUCKETS: { id: string; label: string; test: RegExp }[] = [
  { id: "reset", label: "Reset to the reference standard", test: /reset|reference|default layout|staging|presentation/i },
  { id: "linen", label: "Beds & linen", test: /bed|linen|sheet|pillow|duvet|mattress|towel|bath mat/i },
  { id: "appliances", label: "Appliances (inside and out)", test: /oven|microwave|fridge|freezer|dishwasher|kettle|toaster|coffee|rangehood|stovetop|appliance|tv|air ?con/i },
  { id: "surfaces", label: "Surfaces, benches & cupboards", test: /bench|splashback|surface|cupboard|drawer|shelf|vanity|cabinet|sink|tap|wipe|dust/i },
  { id: "sanitary", label: "Toilet, shower & tiles", test: /toilet|shower|screen|tile|grout|basin|sanitis|sanitiz/i },
  { id: "glass", label: "Glass, mirrors & windows", test: /mirror|glass|window|balustrade|railing/i },
  { id: "floors", label: "Floors — vacuumed & mopped", test: /floor|vacuum|mop|sweep|carpet|rug/i },
  { id: "rubbish", label: "Rubbish, bins & liners", test: /bin|rubbish|liner|waste|trash/i },
  { id: "restock", label: "Consumables restocked", test: /restock|consumable|supply|supplies|stock|paper towel|soap|shampoo|conditioner|toilet paper/i },
  { id: "evidence", label: "Evidence photos complete & usable", test: /photo|image|video|picture|evidence/i },
];

const FALLBACK_BUCKET = { id: "general", label: "Overall condition of this area", test: /.*/ };

/**
 * Cross-cutting failures that belong to no single room — the human mistakes
 * that recur regardless of which property is being cleaned.
 */
const COMMON_MISTAKES: { id: string; label: string }[] = [
  { id: "guest-belongings", label: "No guest belongings left behind (all rooms checked)" },
  { id: "odour", label: "Property smells fresh — no lingering odour" },
  { id: "edges-corners", label: "Skirting boards, edges and corners done, not just the middle" },
  { id: "under-furniture", label: "Under beds and behind furniture reached" },
  { id: "high-touch", label: "High-touch points sanitised (switches, handles, remotes)" },
  { id: "vacuum-emptied", label: "Vacuum cleaner emptied and left ready" },
  { id: "appliance-faults", label: "Any appliance fault or damage reported, not ignored" },
  { id: "access-secure", label: "Windows and doors secured, keys returned to the lockbox" },
  { id: "checklist-honest", label: "Checklist reflects what was actually done" },
];

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** A Pass / Minor issues / Fail question — the shape the accountability
 *  workspace derives its verdict from (see VERDICT_TO_LEGACY_ANSWER). */
function passField(id: string, label: string): FormField {
  return {
    id,
    type: "radio",
    label,
    required: true,
    options: ["Pass", "Minor issues", "Fail"],
    scoring: { max: 2, weight: 1 },
  } as unknown as FormField;
}

function photoField(id: string, label: string, min = 1): FormField {
  return { id, type: "photo", label, minPhotos: min } as unknown as FormField;
}

function notesField(id: string): FormField {
  return { id, type: "longtext", label: "Notes (optional)" } as unknown as FormField;
}

export interface GenerateQaTemplateOptions {
  /** Cap on collapsed outcomes per section — keeps the form completable. */
  maxOutcomesPerSection?: number;
  /** Append the cross-cutting "Common mistakes" section. Default true. */
  includeCommonMistakes?: boolean;
}

export interface GeneratedQaTemplate {
  schema: FormSchema;
  /** Section titles copied from the source, for the caller to sanity-check. */
  mirroredSectionTitles: string[];
}

/**
 * Build a QA template from a cleaner checklist schema.
 *
 * Returns null when the source has no usable sections — the caller should fall
 * back to the built-in default rather than generating an empty form.
 */
export function generateQaTemplateFromChecklist(
  source: FormSchema | null | undefined,
  options: GenerateQaTemplateOptions = {}
): GeneratedQaTemplate | null {
  const sourceSections = Array.isArray(source?.sections) ? (source!.sections as any[]) : [];
  if (sourceSections.length === 0) return null;

  const maxOutcomes = Math.max(1, options.maxOutcomesPerSection ?? 6);
  const sections: FormSection[] = [];
  const mirroredSectionTitles: string[] = [];

  for (const section of sourceSections) {
    const title = String(section.title ?? section.label ?? "").trim();
    if (!title) continue;

    const fields = Array.isArray(section.fields) ? section.fields : [];
    // Instructional copy isn't work — grading it would be grading a paragraph.
    const workFields = fields.filter(
      (f: any) => f?.type && !["instruction", "signature", "inventory"].includes(String(f.type))
    );
    if (workFields.length === 0) continue;

    // Collapse the section's fields into the outcome buckets they touch.
    const hit = new Map<string, { label: string; examples: string[] }>();
    for (const field of workFields) {
      const label = String(field.label ?? "");
      const bucket = OUTCOME_BUCKETS.find((b) => b.test.test(label)) ?? FALLBACK_BUCKET;
      const entry = hit.get(bucket.id) ?? { label: bucket.label, examples: [] };
      if (label && entry.examples.length < 4) entry.examples.push(label);
      hit.set(bucket.id, entry);
    }

    const chosen = Array.from(hit.entries()).slice(0, maxOutcomes);
    const qaFields: FormField[] = [
      ...chosen.map(([bucketId, entry]) => {
        const f = passField(`${section.id}-${bucketId}`, entry.label);
        // Carry the source items as help text so the inspector knows exactly
        // which checklist lines this one verdict is standing in for.
        if (entry.examples.length) {
          (f as any).helpText = `Covers: ${entry.examples.join(" · ")}`;
        }
        return f;
      }),
      photoField(`${section.id}-evidence`, "Photo evidence for this area", 1),
      notesField(`${section.id}-notes`),
    ];

    sections.push({ id: section.id, title, fields: qaFields } as unknown as FormSection);
    mirroredSectionTitles.push(title);
  }

  if (sections.length === 0) return null;

  if (options.includeCommonMistakes !== false) {
    sections.push({
      id: "common-mistakes",
      title: "Common mistakes",
      description:
        "Cross-cutting checks that belong to no single room — the things most often missed.",
      fields: [
        ...COMMON_MISTAKES.map((m) => passField(`common-${m.id}`, m.label)),
        notesField("common-mistakes-notes"),
      ],
    } as unknown as FormSection);
  }

  // The outcome section. These fields are the INSPECTOR's own output, so the
  // workspace deliberately renders them without a verdict block.
  sections.push({
    id: "outcome",
    title: "Outcome",
    fields: [
      { id: "rework_required", type: "checkbox", label: "Rework required" },
      { id: "client_visible_summary", type: "longtext", label: "Summary the client may see" },
      { id: "qa_notes", type: "longtext", label: "Internal notes (not shown to the cleaner)" },
      { id: "signature", type: "signature", label: "Inspector signature", required: true },
    ],
  } as unknown as FormSection);

  return { schema: { sections } as unknown as FormSchema, mirroredSectionTitles };
}

/**
 * Does a generated QA template still line up with its source checklist?
 *
 * Used to warn an admin that a property's checklist has moved on since the QA
 * form was generated — the failure mode is silent (the cleaner's photos stop
 * appearing beside the grading), so it needs surfacing explicitly.
 */
export function qaTemplateMatchesChecklist(
  qaSchema: FormSchema | null | undefined,
  checklistSchema: FormSchema | null | undefined
): { matches: boolean; missingTitles: string[] } {
  const qaTitles = new Set(
    ((qaSchema?.sections ?? []) as any[]).map((s) => normalise(String(s.title ?? s.label ?? "")))
  );
  const missingTitles = ((checklistSchema?.sections ?? []) as any[])
    .map((s) => String(s.title ?? s.label ?? "").trim())
    .filter((t: string) => t && !qaTitles.has(normalise(t)));
  return { matches: missingTitles.length === 0, missingTitles };
}
