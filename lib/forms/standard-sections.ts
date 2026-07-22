/**
 * The three TEMPLATE-OWNED standard sections.
 *
 * Historically these were injected at read/generate time by
 * `withStandardSections` (lib/checklists/compose.ts) and were therefore
 * invisible to the form builder. Phase 2 makes them template-owned: a template
 * whose schema carries `standardSections: false` opts OUT of injection because
 * the sections are already baked into the stored schema (see
 * scripts/bake-standard-sections.ts), so admins can edit their content.
 *
 * `undefined` (un-migrated templates) still injects — the evidence gates must
 * never silently disappear.
 *
 * This module is intentionally dependency-free (no `@/lib/db`) so client
 * components (the builder) can import it.
 */

export const ARRIVAL_EVIDENCE_SECTION_ID = "arrival-evidence";
export const REPORTED_EXCEPTIONS_SECTION_ID = "reported-exceptions-section";
export const SIGN_OFF_SECTION_ID = "sign-off";

export const STANDARD_SECTION_IDS = [
  ARRIVAL_EVIDENCE_SECTION_ID,
  REPORTED_EXCEPTIONS_SECTION_ID,
  SIGN_OFF_SECTION_ID,
] as const;

export type StandardSectionId = (typeof STANDARD_SECTION_IDS)[number];

export function isStandardSectionId(id: unknown): id is StandardSectionId {
  return typeof id === "string" && (STANDARD_SECTION_IDS as readonly string[]).includes(id);
}

/** Confirmation copy shown before a standard section is deleted in the builder. */
export function standardSectionDeleteWarning(id: string): string {
  if (id === ARRIVAL_EVIDENCE_SECTION_ID) {
    return "Removing this deletes the arrival-evidence requirement for this template — continue?";
  }
  if (id === REPORTED_EXCEPTIONS_SECTION_ID) {
    return "Removing this deletes the exception-reporting requirement for this template — continue?";
  }
  return "Removing this deletes the sign-off requirement for this template — continue?";
}

/**
 * Read the opt-out flag off a raw schema. Only an explicit `false` opts out;
 * anything else (missing / null / true) means "inject the standard sections".
 */
export function schemaOptsOutOfStandardSections(schema: unknown): boolean {
  return Boolean(
    schema &&
      typeof schema === "object" &&
      (schema as Record<string, unknown>).standardSections === false
  );
}
