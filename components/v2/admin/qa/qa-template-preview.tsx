"use client";

/**
 * Read-only preview of a QA template: its sections and criteria with type,
 * weight and maximum, as the inspector's form lists them.
 */
import { EModal } from "@/components/v2/admin/estate-kit";
import { EPill } from "@/components/v2/ui/pill";
import type { TemplateRow } from "./qa-template-editor";

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function score(field: Node): string | null {
  const scoring = isNode(field.scoring) ? field.scoring : field;
  const weight = typeof scoring.weight === "number" ? scoring.weight : null;
  const max = typeof scoring.max === "number" ? scoring.max : null;
  if (weight === null && max === null) return null;
  return `weight ${weight ?? "–"} · max ${max ?? "–"}`;
}

export function QaTemplatePreview({ template, onClose }: { template: TemplateRow | null; onClose: () => void }) {
  const sections = template && isNode(template.schema) && Array.isArray(template.schema.sections) ? template.schema.sections.filter(isNode) : [];
  return (
    <EModal open={Boolean(template)} onClose={onClose} eyebrow="QA template preview" title={template?.name ?? "Preview"} wide>
      {template && sections.length === 0 ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">This template has no sections to show.</p>
      ) : null}
      <div className="space-y-4">
        {sections.map((section, sectionIndex) => (
          <section key={String(section.id ?? sectionIndex)} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
            <h3 className="text-[0.9375rem] font-[600]">{String(section.title ?? section.label ?? `Section ${sectionIndex + 1}`)}</h3>
            <ul className="mt-2 space-y-1.5">
              {(Array.isArray(section.fields) ? section.fields.filter(isNode) : []).map((field, fieldIndex) => (
                <li key={String(field.id ?? fieldIndex)} className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                  <span className="min-w-0 flex-1 break-words">{String(field.label ?? field.id ?? "Criterion")}</span>
                  <EPill>{String(field.type ?? "rating")}</EPill>
                  {score(field) ? <EPill tone="gold">{score(field)}</EPill> : null}
                  {field.required ? <EPill>Required</EPill> : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </EModal>
  );
}
