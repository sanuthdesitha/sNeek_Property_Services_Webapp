"use client";

/**
 * "Cleaner sees": the selected section in a phone frame, rendered by the REAL
 * cleaner renderer (components/v2/cleaner/form-renderer.tsx) in "preview"
 * mode — the same field components, show/hide rules and inline validation,
 * with media capture replaced by a stand-in that uploads nothing and the
 * job-only extras hidden. Taps are kept locally and reset when the section
 * changes; nothing is saved.
 */
import * as React from "react";
import { FormRenderer, type AnswerMap, type UploadMap } from "@/components/v2/cleaner/form-renderer";
import { EPill } from "@/components/v2/ui/pill";
import type { TemplateCheckResult } from "@/lib/forms/template-checks";
import type { FormSchema, FormSection } from "@/lib/forms/types";

export function checksPill(checks: TemplateCheckResult): { label: string; tone: "ok" | "warn" | "bad" } {
  if (checks.errors > 0) return { label: `${checks.errors} problem${checks.errors === 1 ? "" : "s"} to fix`, tone: "bad" };
  if (checks.warnings > 0) return { label: `${checks.warnings} warning${checks.warnings === 1 ? "" : "s"}`, tone: "warn" };
  return { label: "All checks pass", tone: "ok" };
}

export function CleanerPreview({
  section,
  theme,
  checks,
  onShowChecks,
}: {
  section: FormSection | null;
  theme: FormSchema["theme"];
  checks: TemplateCheckResult;
  onShowChecks: () => void;
}) {
  const [answers, setAnswers] = React.useState<AnswerMap>({});
  const [uploads, setUploads] = React.useState<UploadMap>({});
  const sectionId = section?.id ?? null;
  // A different section (or form) starts from a clean phone.
  React.useEffect(() => {
    setAnswers({});
    setUploads({});
  }, [sectionId]);
  const schema = React.useMemo<FormSchema>(() => ({ sections: section ? [section] : [], ...(theme ? { theme } : {}) }), [section, theme]);
  const pill = checksPill(checks);
  const onAnswer = React.useCallback((fieldId: string, value: unknown) => setAnswers((prev) => ({ ...prev, [fieldId]: value })), []);
  const onUpload = React.useCallback((fieldId: string, media: UploadMap[string]) => setUploads((prev) => ({ ...prev, [fieldId]: media })), []);

  return (
    <section aria-label="Cleaner sees" className="flex flex-col items-center gap-3 rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3.5">
      <div className="flex w-full items-center justify-between gap-2">
        <h2 className="e-eyebrow">Cleaner sees</h2>
        <button type="button" onClick={onShowChecks} className="rounded-full focus-visible:outline focus-visible:outline-2" aria-label={`Checks: ${pill.label}. Show the list.`}>
          <EPill tone={pill.tone}>{pill.label}</EPill>
        </button>
      </div>
      <div
        className="w-full max-w-[262px] overflow-hidden rounded-[26px] border-[6px] border-[hsl(var(--e-sidebar-bg))] bg-[hsl(var(--e-background))]"
        aria-label={section ? `Phone preview of the ${section.title} section` : "Phone preview"}
        role="group"
      >
        <div className="max-h-[420px] overflow-y-auto px-3 py-3.5 text-[0.75rem]">
          {section ? (
            section.repeatBy ? (
              <p className="mb-2 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                Shown once per {section.repeatBy === "bathrooms" ? "bathroom" : "bedroom"} of the property.
              </p>
            ) : null
          ) : null}
          {section ? (
            <FormRenderer
              mode="preview"
              schema={schema}
              answers={answers}
              uploads={uploads}
              property={{}}
              onAnswer={onAnswer}
              onUpload={onUpload}
            />
          ) : (
            <p className="text-[hsl(var(--e-text-faint))]">Select a section to preview it.</p>
          )}
        </div>
      </div>
      <p className="text-center text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
        Property rules are previewed for a property with no extras. Use Test as cleaner to try a sample property.
      </p>
    </section>
  );
}
