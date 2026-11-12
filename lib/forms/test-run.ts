/**
 * "Test as cleaner": validate sample answers against a form exactly as the
 * phone and the submit route would, without writing anything.
 *
 * The schema goes through the same read-time steps a job form does that do
 * not need a real job: normalizeFormSchema (standard sections, legacy shapes)
 * and the per-room repeat for the sample property's room counts. Every
 * rotational question is shown (a real job shows only those that are due).
 * Then collectFormErrors runs twice:
 *  - the rules the phone and the submit route enforce today ("blocking");
 *  - the extended rules the submit route records as warnings this release.
 *
 * PURE: no database, no session, no network.
 */
import { normalizeFormSchema } from "./normalize-schema";
import { expandRepeatedSections } from "./repeat-sections";
import { collectFormErrors, EXTENDED_FORM_RULES, ENFORCE_EXTENDED_FORM_VALIDATION, type FormErrorRule } from "./validate-submission";
import { jobFormPropertySelect } from "./job-form-property";
import { planSubmissionEffects, wouldHappenSentence } from "./form-effects";

export type TestRunProblem = {
  fieldId: string;
  label: string;
  sectionLabel?: string;
  message: string;
  rule: FormErrorRule | "unknown";
  /** blocking: the phone and server refuse; warning: recorded on the submission this release. */
  level: "blocking" | "warning";
};

export type TestRunInput = {
  schema: unknown;
  answers: Record<string, unknown>;
  uploadCounts: Record<string, number>;
  property: Record<string, unknown>;
  laundryReady?: boolean;
  requiredChecklistTicksBlockSubmit: boolean;
  /** The organisation's "reject submissions that break the extended checks" switch (default: the release constant). */
  enforceExtended?: boolean;
};

export type TestRunResult = {
  problems: TestRunProblem[];
  blocking: number;
  warnings: number;
  /** The schema the sample was checked against (after the read-time steps). */
  checkedSchema: unknown;
  /** What the answers' question effects WOULD do on a real submission (none of it is done). */
  wouldHappen: string[];
};

/** Only the cleaner-visible property keys, as a real job form receives. */
export function sampleProperty(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(([key]) => Object.hasOwn(jobFormPropertySelect, key)),
  );
}

export function runFormTest(input: TestRunInput): TestRunResult {
  const property = sampleProperty(input.property);
  const checkedSchema = expandRepeatedSections(normalizeFormSchema(input.schema), property);
  const errors = collectFormErrors(
    checkedSchema,
    input.answers,
    input.uploadCounts,
    property,
    input.laundryReady,
    input.requiredChecklistTicksBlockSubmit,
    undefined,
    { extended: true },
  );
  const problems = errors.map<TestRunProblem>((error) => {
    const extended = Boolean(error.rule && EXTENDED_FORM_RULES.has(error.rule));
    return {
      fieldId: error.fieldId,
      label: error.label,
      ...(error.sectionLabel ? { sectionLabel: error.sectionLabel } : {}),
      message: error.message,
      rule: error.rule ?? "unknown",
      level: extended && !(input.enforceExtended ?? ENFORCE_EXTENDED_FORM_VALIDATION) ? "warning" : "blocking",
    };
  });
  return {
    problems,
    blocking: problems.filter((problem) => problem.level === "blocking").length,
    warnings: problems.filter((problem) => problem.level === "warning").length,
    checkedSchema,
    wouldHappen: wouldHappenSentence(planSubmissionEffects(checkedSchema, input.answers, property, input.laundryReady)),
  };
}
