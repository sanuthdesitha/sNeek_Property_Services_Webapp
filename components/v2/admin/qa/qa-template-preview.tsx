"use client";

/**
 * Read-only preview of a QA template: its sections and criteria as the
 * inspector's form lists them (rating stars, Yes / No, choices), with weight
 * and required in words. `QaTemplatePreview` keeps the old dialog for any
 * caller; the editor shows `QaTemplatePreviewBody` inline.
 */
import { EModal } from "@/components/v2/admin/estate-kit";
import { criterionNote, isEditableSchema, optionWords, sectionTitle, type LooseField, type LooseSection } from "./qa-template-schema";
import type { TemplateRow } from "./qa-template-editor";

function Answer({ field }: { field: LooseField }) {
  const type = String(field.type ?? "rating");
  if (type === "rating") return <span aria-label="Rating" className="tracking-[0.15em] text-[hsl(var(--e-gold-ink))]">★★★★★</span>;
  if (type === "yesno") {
    return (
      <span className="inline-flex overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] text-[0.75rem]">
        <span className="px-2 py-0.5">Yes</span>
        <span className="border-l border-[hsl(var(--e-border))] px-2 py-0.5">No</span>
      </span>
    );
  }
  const options = optionWords(field);
  if (options.length > 0) return <span className="text-[hsl(var(--e-text-secondary))]">{options.join(" · ")}</span>;
  if (type === "photo" || type === "upload") return <span className="text-[hsl(var(--e-text-secondary))]">Photo</span>;
  if (type === "checkbox") return <span className="text-[hsl(var(--e-text-secondary))]">Tick</span>;
  return <span className="text-[hsl(var(--e-text-secondary))]">Text</span>;
}

export function QaTemplatePreviewBody({ schema, compact = false }: { schema: unknown; compact?: boolean }) {
  const sections: LooseSection[] = isEditableSchema(schema) ? schema.sections.filter((section) => section && typeof section === "object") : [];
  if (sections.length === 0) return <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">This template has no sections to show.</p>;
  return (
    <div className="space-y-3">
      {sections.map((section, sectionIndex) => (
        <section key={String(section.id ?? sectionIndex)}>
          <h5 className="text-[0.6875rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-gold-ink))]">{sectionTitle(section, sectionIndex)}</h5>
          <ul className="mt-1 divide-y divide-[hsl(var(--e-border))]">
            {(Array.isArray(section.fields) ? section.fields : []).slice(0, compact ? 6 : undefined).map((field, fieldIndex) => {
              const note = criterionNote(field);
              return (
                <li key={String(field.id ?? fieldIndex)} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[0.8125rem]">
                  <span className="min-w-0 break-words">
                    {String(field.label ?? field.id ?? "Criterion")}
                    {note ? <span className="text-[hsl(var(--e-text-secondary))]"> · {note}</span> : null}
                  </span>
                  <Answer field={field} />
                </li>
              );
            })}
          </ul>
          {compact && Array.isArray(section.fields) && section.fields.length > 6 ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{section.fields.length - 6} more</p>
          ) : null}
        </section>
      ))}
    </div>
  );
}

export function QaTemplatePreview({ template, onClose }: { template: TemplateRow | null; onClose: () => void }) {
  return (
    <EModal open={Boolean(template)} onClose={onClose} eyebrow="QA template preview" title={template?.name ?? "Preview"} wide>
      {template ? <QaTemplatePreviewBody schema={template.schema} /> : null}
    </EModal>
  );
}
