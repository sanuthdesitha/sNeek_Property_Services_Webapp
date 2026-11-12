"use client";

/**
 * "Edit a question in all N selected forms": choose a question that exists in
 * the selection (read from the forms' working copies), the property to change
 * and the new value; preview each form's before/after; save as drafts.
 */
import * as React from "react";
import { EInput, ESelect } from "@/components/v2/admin/estate-kit";
import type { QuestionIndexEntry } from "@/lib/forms/template-questions";
import type { BulkOperation } from "@/lib/forms/template-bulk-types";
import type { EditableQuestionProperty } from "@/lib/forms/template-bulk-edits";
import { BulkLabel, BulkPanelShell } from "./bulk-panel-shell";
import { useBulkRun } from "./use-bulk-run";

type QuestionsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; formCount: number; questions: QuestionIndexEntry[] };

const PROPERTIES: Array<{ key: EditableQuestionProperty; label: string }> = [
  { key: "minPhotos", label: "Minimum photos" },
  { key: "maxFiles", label: "Maximum files" },
  { key: "required", label: "Required" },
  { key: "label", label: "Question wording" },
  { key: "helpText", label: "Help text" },
  { key: "severity", label: "Priority" },
  { key: "detailsWhenNo", label: "Ask for details when No" },
];

function useQuestions(templateIds: string[]): QuestionsState {
  const [state, setState] = React.useState<QuestionsState>({ status: "loading" });
  const ids = [...templateIds].sort().join(",");
  React.useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    (async () => {
      try {
        const response = await fetch(`/api/admin/form-templates/questions?ids=${encodeURIComponent(ids)}`, { cache: "no-store", signal: controller.signal });
        const body = (await response.json().catch(() => null)) as { questions?: QuestionIndexEntry[]; formCount?: number; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !Array.isArray(body?.questions)) throw new Error(body?.error ?? "The questions could not be loaded.");
        setState({ status: "ready", formCount: body?.formCount ?? 0, questions: body.questions });
      } catch (cause) {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: cause instanceof Error ? cause.message : "The questions could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [ids]);
  return state;
}

function buildOperation(question: QuestionIndexEntry | undefined, property: EditableQuestionProperty, raw: string): BulkOperation | { invalid: string } {
  if (!question) return { invalid: "Choose a question." };
  const match = question.match;
  switch (property) {
    case "minPhotos":
    case "maxFiles": {
      const value = Number(raw);
      const min = property === "minPhotos" ? 0 : 1;
      if (!/^\d+$/.test(raw.trim()) || value < min || value > (property === "minPhotos" ? 20 : 50)) {
        return { invalid: property === "minPhotos" ? "Enter a whole number from 0 to 20." : "Enter a whole number from 1 to 50." };
      }
      return { type: "edit-question", match, edit: { property, value } };
    }
    case "required":
    case "detailsWhenNo":
      if (raw !== "yes" && raw !== "no") return { invalid: "Choose Yes or No." };
      return { type: "edit-question", match, edit: { property, value: raw === "yes" } };
    case "severity":
      return { type: "edit-question", match, edit: { property, value: raw === "low" || raw === "medium" || raw === "high" ? raw : null } };
    case "label":
      if (!raw.trim()) return { invalid: "Enter the new wording." };
      return { type: "edit-question", match, edit: { property, value: raw } };
    default:
      return { type: "edit-question", match, edit: { property: "helpText", value: raw } };
  }
}

function ValueInput({ id, property, value, onChange }: { id: string; property: EditableQuestionProperty; value: string; onChange: (v: string) => void }) {
  if (property === "required" || property === "detailsWhenNo") {
    return (
      <ESelect id={id} className="w-28" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </ESelect>
    );
  }
  if (property === "severity") {
    return (
      <ESelect id={id} className="w-32" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">None</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </ESelect>
    );
  }
  const numeric = property === "minPhotos" || property === "maxFiles";
  return (
    <EInput
      id={id}
      className={numeric ? "e-tnum w-20" : "w-64 max-w-full"}
      inputMode={numeric ? "numeric" : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function BulkQuestionPanel({ templateIds, onApplied }: { templateIds: string[]; onApplied: () => void }) {
  const questions = useQuestions(templateIds);
  const run = useBulkRun(templateIds, onApplied);
  const [questionKey, setQuestionKey] = React.useState("");
  const [property, setProperty] = React.useState<EditableQuestionProperty>("minPhotos");
  const [value, setValue] = React.useState("");
  const ids = { q: React.useId(), p: React.useId(), v: React.useId() };
  const list = questions.status === "ready" ? questions.questions : [];
  const selected = list.find((q) => q.key === questionKey);
  const operation = buildOperation(selected, property, value);
  function changeProperty(next: EditableQuestionProperty) {
    setProperty(next);
    setValue("");
  }
  const changeCount = run.preview && "type" in operation && run.previewMatches(operation) ? run.preview.summary.changed : null;

  return (
    <BulkPanelShell
      title={`Edit a question in all ${templateIds.length} selected form${templateIds.length === 1 ? "" : "s"}`}
      operation={operation}
      run={run}
      previewLabel={changeCount === null ? "Preview changes" : `Preview ${changeCount} change${changeCount === 1 ? "" : "s"}`}
      saveLabel="Save as drafts"
      footnote="Changes are saved as a new draft version of each form. Nothing reaches cleaners until you publish, and any version can be restored. A form where the question is missing or appears twice is left unchanged."
    >
      {() => (
        <>
          <div className="min-w-0">
            <BulkLabel htmlFor={ids.q}>Question</BulkLabel>
            <ESelect id={ids.q} className="w-[17rem] max-w-full" value={questionKey} onChange={(e) => setQuestionKey(e.target.value)} disabled={questions.status !== "ready"}>
              <option value="">{questions.status === "loading" ? "Loading questions…" : questions.status === "error" ? "Questions unavailable" : "Choose a question"}</option>
              {list.map((q) => (
                <option key={q.key} value={q.key}>
                  {q.match.section ? `${q.match.section}: ` : ""}
                  {q.match.label} (in {q.formCount} of {templateIds.length})
                </option>
              ))}
            </ESelect>
            {questions.status === "error" ? <p role="alert" className="mt-1 text-[0.75rem] text-[hsl(var(--e-danger))]">{questions.message}</p> : null}
          </div>
          <div>
            <BulkLabel htmlFor={ids.p}>Change</BulkLabel>
            <ESelect id={ids.p} className="w-52" value={property} onChange={(e) => changeProperty(e.target.value as EditableQuestionProperty)}>
              {PROPERTIES.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </ESelect>
          </div>
          <div>
            <BulkLabel htmlFor={ids.v}>New value</BulkLabel>
            <ValueInput id={ids.v} property={property} value={value} onChange={setValue} />
          </div>
        </>
      )}
    </BulkPanelShell>
  );
}
