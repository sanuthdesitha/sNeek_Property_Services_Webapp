// Single source of truth for identifying the composed final self-inspection
// section inside a form schema.
//
// The section id is the checklist module key ("final-inspection"), but the
// checklist catalog imports `@prisma/client`, so client-bundled form code
// (visibility.ts → the v2 renderer) can't import it directly. The literal lives
// here, `lib/checklists/catalog.ts` re-exports it as SELF_INSPECTION_MODULE_KEY,
// and both sides compare against the same value.
//
// Why it matters: the self-inspection checkboxes are deliberately EXEMPT from
// the generic "a required checkbox must be ticked" rule, because the submit
// route owns them with its own gate (collectUntickedSelfInspection) which the
// `accountability.selfInspectionBlocksSubmit` setting can switch off. If the
// generic rule also fired on them, that opt-out would stop working.

/** Section id of the composed final self-inspection section. */
export const SELF_INSPECTION_SECTION_ID = "final-inspection";

/** True when a schema section is the composed final self-inspection section. */
export function isSelfInspectionSection(section: unknown): boolean {
  const id = (section as { id?: unknown } | null | undefined)?.id;
  return typeof id === "string" && id.trim() === SELF_INSPECTION_SECTION_ID;
}
