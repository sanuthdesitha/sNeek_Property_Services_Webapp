"use client";

/**
 * "What applicants see" beside the application form editor (board "Hiring",
 * 2026-11-16): the draft's sections one at a time, as the public apply page
 * asks them. A preview only: nothing here can be submitted or saved.
 */
import { useEffect, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import type { AppField, AppStep } from "./types";

function PreviewControl({ field }: { field: AppField }) {
  if (field.type === "single" && (field.options?.length ?? 0) <= 3) {
    return (
      <div role="radiogroup" aria-label={field.label} className="flex flex-wrap gap-1 rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] p-1">
        {(field.options ?? []).map((option, index) => (
          <span key={option} className={`rounded-[var(--e-radius-sm)] px-3 py-1.5 text-[0.8125rem] ${index === 0 ? "bg-[hsl(var(--e-surface))] font-[550] shadow-[var(--e-elevation-1)]" : ""}`}>{option}</span>
        ))}
      </div>
    );
  }
  if (field.type === "single") {
    return (
      <ESelect disabled value="">
        <option value="">Choose…</option>
        {(field.options ?? []).map((option) => <option key={option}>{option}</option>)}
      </ESelect>
    );
  }
  if (field.type === "multi") {
    return (
      <div className="flex flex-wrap gap-1.5">
        {(field.options ?? []).map((option) => (
          <span key={option} className="rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] px-2.5 py-1 text-[0.75rem]">{option}</span>
        ))}
      </div>
    );
  }
  if (field.type === "longText") return <ETextarea disabled rows={2} placeholder={field.placeholder} />;
  if (field.type === "file") return <p className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] px-3 py-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Upload a file</p>;
  return <EInput disabled placeholder={field.placeholder ?? ""} />;
}

export function ApplicantPreview({ title, steps }: { title: string; steps: AppStep[] }) {
  const [index, setIndex] = useState(0);
  const total = steps.length;
  useEffect(() => {
    if (index > Math.max(0, total - 1)) setIndex(Math.max(0, total - 1));
  }, [index, total]);
  const step = steps[index];
  return (
    <section aria-labelledby="applicant-preview-title" className="min-w-0">
      <h2 id="applicant-preview-title" className="e-eyebrow mb-2">What applicants see</h2>
      <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
        <p className="font-semibold">{title || "Untitled role"} at sNeek</p>
        {step ? (
          <>
            <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Section {index + 1} of {total} · {step.title}</p>
            <div className="mt-3 space-y-3">
              {step.fields.slice(0, 6).map((field) => (
                <EField key={field.id} label={<>{field.label}{field.required ? <span className="sr-only"> (required)</span> : null}</>}>
                  <PreviewControl field={field} />
                </EField>
              ))}
              {step.fields.length > 6 ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">and {step.fields.length - 6} more questions</p> : null}
              {step.fields.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">This section has no questions yet.</p> : null}
            </div>
            <div className="mt-4 flex gap-2">
              {index > 0 ? <EButton type="button" variant="outline" size="sm" onClick={() => setIndex(index - 1)}>Back</EButton> : null}
              <EButton type="button" size="sm" className="flex-1" onClick={() => setIndex(Math.min(total - 1, index + 1))} disabled={index >= total - 1}>
                {index >= total - 1 ? "Last section" : "Next"}
              </EButton>
            </div>
          </>
        ) : (
          <p className="mt-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No sections yet.</p>
        )}
        <p className="mt-3 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">Preview only: nothing here is submitted.</p>
      </div>
    </section>
  );
}
