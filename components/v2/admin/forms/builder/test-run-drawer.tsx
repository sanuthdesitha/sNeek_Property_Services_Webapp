"use client";

/**
 * "Test as cleaner": the whole form in the real cleaner renderer, in sandbox
 * mode (media are pretend counts, nothing is uploaded, no job extras). Fill it
 * in as a cleaner would, pick a sample property, then "Check answers" runs the
 * phone's validation here AND the server's (POST …/test-run, which writes
 * nothing) and lists the problems per question.
 *
 * Every rotating question is shown; a real job shows only the ones due. The
 * device and laundry additions a real job may get are not simulated.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EField, EInput } from "@/components/v2/admin/estate-kit";
import { FormRenderer, type AnswerMap, type UploadMap } from "@/components/v2/cleaner/form-renderer";
import { collectFormErrors, EXTENDED_FORM_RULES } from "@/lib/forms/validate-submission";
import { expandRepeatedSections } from "@/lib/forms/repeat-sections";
import type { TestRunProblem } from "@/lib/forms/test-run";
import type { FormSchema } from "@/lib/forms/types";
import { BuilderDrawer } from "./builder-drawer";

type SampleProperty = { bedrooms: number; bathrooms: number; hasBalcony: boolean; inventoryEnabled: boolean; laundryEnabled: boolean; sofaBedCount: number };
const DEFAULT_PROPERTY: SampleProperty = { bedrooms: 2, bathrooms: 1, hasBalcony: false, inventoryEnabled: false, laundryEnabled: false, sofaBedCount: 0 };

type Result = { phone: TestRunProblem[]; server: TestRunProblem[] | null; serverError: string | null; wouldHappen: string[] };

function ProblemList({ title, problems }: { title: string; problems: TestRunProblem[] }) {
  return (
    <div>
      <p className="text-[0.8125rem] font-[600]">{title}</p>
      {problems.length === 0 ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-success))]">No problems.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {problems.map((problem) => (
            <li key={`${problem.fieldId}-${problem.rule}`} className="flex flex-wrap items-baseline gap-1.5 text-[0.75rem]">
              <EPill tone={problem.level === "blocking" ? "bad" : "warn"}>{problem.level === "blocking" ? "Blocks submit" : "Warning"}</EPill>
              <span className="font-[600]">{problem.sectionLabel ? `${problem.sectionLabel}: ` : ""}{problem.label}</span>
              <span className="text-[hsl(var(--e-text-secondary))]">— {problem.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TestRunDrawer({ open, onClose, templateId, schema }: { open: boolean; onClose: () => void; templateId: string; schema: FormSchema }) {
  const [answers, setAnswers] = React.useState<AnswerMap>({});
  const [uploads, setUploads] = React.useState<UploadMap>({});
  const [property, setProperty] = React.useState<SampleProperty>(DEFAULT_PROPERTY);
  const [checking, setChecking] = React.useState(false);
  const [result, setResult] = React.useState<Result | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setAnswers({});
    setUploads({});
    setResult(null);
  }, [open]);
  const shown = React.useMemo(() => expandRepeatedSections(schema, property), [schema, property]);
  const uploadCounts = React.useMemo(() => Object.fromEntries(Object.entries(uploads).map(([id, media]) => [id, media.length])), [uploads]);
  const onAnswer = React.useCallback((fieldId: string, value: unknown) => setAnswers((prev) => ({ ...prev, [fieldId]: value })), []);
  const onUpload = React.useCallback((fieldId: string, media: UploadMap[string]) => setUploads((prev) => ({ ...prev, [fieldId]: media })), []);

  async function check() {
    setChecking(true);
    const phone = collectFormErrors(shown, answers, uploadCounts, property, undefined, false, undefined, { extended: true }).map<TestRunProblem>((error) => ({
      fieldId: error.fieldId,
      label: error.label,
      sectionLabel: error.sectionLabel,
      message: error.message,
      rule: error.rule ?? "unknown",
      level: error.rule && EXTENDED_FORM_RULES.has(error.rule) ? "warning" : "blocking",
    }));
    let server: TestRunProblem[] | null = null;
    let serverError: string | null = null;
    let wouldHappen: string[] = [];
    try {
      const response = await fetch(`/api/admin/form-templates/${templateId}/test-run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schema, answers, uploadCounts, property }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `The server check failed (${response.status}).`);
      server = Array.isArray(body.problems) ? (body.problems as TestRunProblem[]) : [];
      wouldHappen = Array.isArray(body.wouldHappen) ? body.wouldHappen.filter((line: unknown): line is string => typeof line === "string") : [];
    } catch (error) {
      serverError = error instanceof Error ? error.message : "The server check failed.";
    }
    setResult({ phone, server, serverError, wouldHappen });
    setChecking(false);
  }

  const setNumber = (key: "bedrooms" | "bathrooms" | "sofaBedCount") => (event: React.ChangeEvent<HTMLInputElement>) =>
    setProperty((prev) => ({ ...prev, [key]: Math.max(0, Math.floor(Number(event.target.value) || 0)) }));
  const setFlag = (key: "hasBalcony" | "inventoryEnabled" | "laundryEnabled") => (event: React.ChangeEvent<HTMLInputElement>) =>
    setProperty((prev) => ({ ...prev, [key]: event.target.checked }));

  return (
    <BuilderDrawer open={open} onClose={onClose} eyebrow="Sandbox — nothing is saved or sent" title="Test as cleaner" wide>
      <fieldset className="mb-4 grid grid-cols-3 gap-2 rounded-[10px] border border-[hsl(var(--e-border))] p-3">
        <legend className="px-1 text-[0.75rem] font-[600]">Sample property</legend>
        <EField label="Bedrooms"><EInput type="number" min={0} value={property.bedrooms} onChange={setNumber("bedrooms")} /></EField>
        <EField label="Bathrooms"><EInput type="number" min={0} value={property.bathrooms} onChange={setNumber("bathrooms")} /></EField>
        <EField label="Sofa beds"><EInput type="number" min={0} value={property.sofaBedCount} onChange={setNumber("sofaBedCount")} /></EField>
        {(["hasBalcony", "inventoryEnabled", "laundryEnabled"] as const).map((key) => (
          <label key={key} className="col-span-3 flex items-center gap-2 text-[0.8125rem] sm:col-span-1">
            <input type="checkbox" className="accent-[hsl(var(--e-primary))]" checked={property[key]} onChange={setFlag(key)} />
            {key === "hasBalcony" ? "Balcony" : key === "inventoryEnabled" ? "Tracks stock" : "Laundry service"}
          </label>
        ))}
      </fieldset>
      <p className="mb-3 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Every rotating question is shown here; a real job shows only those due. Photos are pretend counts — nothing is uploaded, and no submission, evidence, time record or notification is created.
      </p>
      <div className="rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-background))] p-3">
        <FormRenderer mode="sandbox" schema={shown} answers={answers} uploads={uploads} property={property} onAnswer={onAnswer} onUpload={onUpload} />
      </div>
      <div className="sticky bottom-0 mt-4 space-y-3 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] pt-3">
        <div className="flex flex-wrap gap-2">
          <EButton size="sm" onClick={() => void check()} disabled={checking}>
            {checking ? "Checking…" : "Check answers"}
          </EButton>
          <EButton variant="outline" size="sm" onClick={() => { setAnswers({}); setUploads({}); setResult(null); }}>
            Start again
          </EButton>
        </div>
        {result ? (
          <div className="space-y-3" aria-live="polite">
            <ProblemList title="On the phone" problems={result.phone} />
            {result.serverError ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{result.serverError}</p> : null}
            {result.server ? <ProblemList title="On the server (submit)" problems={result.server} /> : null}
            {result.wouldHappen.length > 0 ? (
              <div>
                <p className="text-[0.8125rem] font-[600]">On a real submission (not done in this test)</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                  {result.wouldHappen.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </BuilderDrawer>
  );
}
