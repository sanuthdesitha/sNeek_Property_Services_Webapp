"use client";

/**
 * QA template editor, below the list (board "QA templates", 2026-11-17; it
 * used to be a separate dialog). Everything it had stays: the name, sections
 * with criteria (type, weight, max, options, required, move up and down), raw
 * JSON and a preview. A section reads as one table. Saving PATCHes the
 * template with the updatedAt it loaded (409 keeps the draft with "Load their
 * version"); the server records the change as the next revision, and
 * inspections already submitted keep their own copy of the template.
 * Overlapping templates are warned about, never refused. Read only (no
 * ADMIN): the same editor with every field locked and no Save.
 */
import * as React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import { EConfirmButton, EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { cn } from "@/lib/utils";
import type { JobType } from "@prisma/client";
import { QaTemplatePreviewBody } from "./qa-template-preview";
import {
  CRITERION_TYPES,
  fieldMax,
  fieldWeight,
  hasOptions,
  isEditableSchema,
  isScorable,
  moveItem,
  newId,
  optionWords,
  parseRawSchema,
  sectionTitle,
  type LooseField,
  type LooseSection,
} from "./qa-template-schema";

export type TemplateRow = {
  id: string;
  name: string;
  serviceType: JobType;
  version: number;
  isActive: boolean;
  propertyId: string | null;
  property?: { id: string; name: string; suburb: string } | null;
  schema: unknown;
  updatedAt?: string;
  createdAt?: string;
};

export type PropertyOption = { id: string; name: string; suburb: string };

type Mode = "sections" | "preview" | "raw";

export type QaTemplateEditorProps = {
  template: TemplateRow;
  revisions: number | null;
  canWrite: boolean;
  /** A sentence when this template overlaps another active one (warns, never blocks). */
  overlapNote: string | null;
  onClose: () => void;
  onSaved: (template: TemplateRow, revision: number | null) => void;
};

const CELL = "px-1.5 py-1.5 align-middle";

function errorText(body: unknown, fallback: string): string {
  return body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : fallback;
}

function initialSections(schema: unknown): LooseSection[] {
  return isEditableSchema(schema) ? (JSON.parse(JSON.stringify(schema.sections)) as LooseSection[]) : [];
}

function extraOf(schema: unknown): Record<string, unknown> {
  if (!isEditableSchema(schema)) return {};
  const { sections: _sections, ...extra } = schema;
  return extra;
}

export function QaTemplateEditor({ template, revisions, canWrite, overlapNote, onClose, onSaved }: QaTemplateEditorProps) {
  const structuredOk = isEditableSchema(template.schema);
  const [name, setName] = React.useState(template.name);
  const [sections, setSections] = React.useState<LooseSection[]>(() => initialSections(template.schema));
  const [extra, setExtra] = React.useState<Record<string, unknown>>(() => extraOf(template.schema));
  const [mode, setMode] = React.useState<Mode>(structuredOk ? "sections" : "raw");
  const [rawText, setRawText] = React.useState(() => JSON.stringify(template.schema ?? {}, null, 2));
  const [rawDirty, setRawDirty] = React.useState(false);
  const [open, setOpen] = React.useState<Record<number, boolean>>({ 0: true });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState<TemplateRow | null>(null);
  const locked = !canWrite || saving;

  const baseline = React.useMemo(() => JSON.stringify(template.schema ?? {}), [template.schema]);
  const currentSchema = React.useMemo<unknown>(() => {
    if (mode === "raw" || !structuredOk) {
      const parsed = parseRawSchema(rawText);
      return parsed.ok ? parsed.value : null;
    }
    return { ...extra, sections };
  }, [mode, structuredOk, rawText, extra, sections]);
  const schemaChanged = rawDirty || (currentSchema !== null && JSON.stringify(currentSchema) !== baseline);
  const dirty = name.trim() !== template.name || schemaChanged;
  const nextRevision = revisions === null ? null : revisions + 1;

  function patchSection(index: number, patch: Partial<LooseSection>) {
    setSections((current) => current.map((section, i) => (i === index ? { ...section, ...patch } : section)));
  }
  function patchField(sectionIndex: number, fieldIndex: number, patch: Partial<LooseField>) {
    setSections((current) =>
      current.map((section, i) => (i === sectionIndex ? { ...section, fields: (section.fields ?? []).map((field, j) => (j === fieldIndex ? { ...field, ...patch } : field)) } : section)),
    );
  }
  function setScore(sectionIndex: number, fieldIndex: number, key: "weight" | "max", raw: string) {
    setSections((current) =>
      current.map((section, i) => {
        if (i !== sectionIndex) return section;
        const fields = (section.fields ?? []).map((field, j) => {
          if (j !== fieldIndex) return field;
          const value = raw === "" ? undefined : Number(raw);
          const next: LooseField = { ...field };
          if (next.scoring && typeof next.scoring === "object") next.scoring = { ...next.scoring, [key]: value };
          else next[key] = value;
          return next;
        });
        return { ...section, fields };
      }),
    );
  }
  function moveField(sectionIndex: number, fieldIndex: number, direction: -1 | 1) {
    setSections((current) => current.map((section, i) => (i === sectionIndex ? { ...section, fields: moveItem(section.fields ?? [], fieldIndex, direction) } : section)));
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    if (mode === "raw" && next !== "raw") {
      const parsed = parseRawSchema(rawText);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      if (!isEditableSchema(parsed.value)) {
        setError("The raw JSON has no sections array, so only raw editing is possible.");
        return;
      }
      setSections(parsed.value.sections);
      setExtra(extraOf(parsed.value));
      setRawDirty(false);
    }
    if (next === "raw") setRawText(JSON.stringify({ ...extra, sections }, null, 2));
    setError(null);
    setMode(next);
  }

  async function save() {
    let templateSchema: unknown;
    if (mode === "raw" || !structuredOk) {
      const parsed = parseRawSchema(rawText);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      templateSchema = parsed.value;
    } else {
      templateSchema = { ...extra, sections };
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/qa/templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || undefined, templateSchema, ...(template.updatedAt ? { expectedUpdatedAt: template.updatedAt } : {}) }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 409) {
        setConflict(((body as { current?: TemplateRow } | null)?.current ?? null));
        setError(errorText(body, "Someone else saved this template. Your changes are kept here."));
        return;
      }
      if (!response.ok) {
        setError(`The template was not saved: ${errorText(body, `the server answered ${response.status}`)}. Your changes are kept.`);
        return;
      }
      const saved = body as TemplateRow & { revision?: number | null };
      setRawDirty(false);
      onSaved(saved, typeof saved.revision === "number" ? saved.revision : null);
    } catch {
      setError("The template was not saved: the server could not be reached. Your changes are kept.");
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setName(template.name);
    setSections(initialSections(template.schema));
    setExtra(extraOf(template.schema));
    setRawText(JSON.stringify(template.schema ?? {}, null, 2));
    setRawDirty(false);
    setError(null);
  }

  const previewSchema = currentSchema ?? template.schema;

  return (
    <section aria-labelledby="qa-editor-heading" className="space-y-3" data-unsaved={canWrite && dirty ? "true" : undefined}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id="qa-editor-heading" className="font-serif text-[1.375rem] leading-tight">{canWrite ? "Editing" : "Viewing"} {template.name}</h3>
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          {canWrite
            ? `Saving records ${nextRevision === null ? "the next revision" : `revision ${nextRevision}`}; inspections already submitted keep their copy (version stays v${template.version}).`
            : "Only administrators edit QA templates."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <ECard className="min-w-0 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <EField label="Template name" className="min-w-0 flex-1">
              <EInput value={name} disabled={locked} onChange={(event) => setName(event.target.value)} className="max-sm:h-11 max-sm:text-base" />
            </EField>
            <div role="tablist" aria-label="Editor view" className="flex overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] max-sm:w-full">
              {(["sections", "preview", "raw"] as Mode[]).map((key, index) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={mode === key}
                  disabled={key === "sections" && !structuredOk}
                  onClick={() => switchMode(key)}
                  className={cn(
                    "min-h-10 px-3 text-[0.8125rem] font-[550] disabled:opacity-50 max-sm:min-h-11 max-sm:flex-1",
                    index > 0 && "border-l border-[hsl(var(--e-border))]",
                    mode === key ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]" : "text-[hsl(var(--e-text-secondary))]",
                  )}
                >
                  {key === "sections" ? "Sections" : key === "preview" ? "Preview" : "Raw JSON"}
                </button>
              ))}
            </div>
          </div>

          {overlapNote ? (
            <p role="status" className={cn("mt-3 rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem]", toneNoticeClass("attention"))}>
              {overlapNote} Saving is still allowed.
            </p>
          ) : null}

          <fieldset disabled={locked} className="mt-3 min-w-0">
            <legend className="sr-only">Template content</legend>
            {mode === "raw" ? (
              <EField label="Schema JSON" hint={structuredOk ? "Invalid JSON is not saved; the error names the line." : "This schema has no sections array, so only raw editing is possible."}>
                <textarea
                  value={rawText}
                  onChange={(event) => { setRawText(event.target.value); setRawDirty(true); }}
                  spellCheck={false}
                  className="min-h-[20rem] w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] p-3 font-mono text-[0.75rem]"
                />
              </EField>
            ) : mode === "preview" ? (
              <QaTemplatePreviewBody schema={previewSchema} />
            ) : (
              <div className="space-y-3">
                {sections.map((section, sectionIndex) => {
                  const fields = section.fields ?? [];
                  const isOpen = open[sectionIndex] === true;
                  return (
                    <div key={String(section.id ?? sectionIndex)} className="min-w-0 overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                      <div className="flex flex-wrap items-center gap-2 bg-[hsl(var(--e-surface-raised))] px-2 py-2">
                        <span className="flex">
                          <EButton type="button" variant="ghost" size="icon" aria-label={`Move ${sectionTitle(section, sectionIndex)} up`} disabled={locked || sectionIndex === 0} onClick={() => setSections((current) => moveItem(current, sectionIndex, -1))}><ArrowUp className="h-4 w-4" /></EButton>
                          <EButton type="button" variant="ghost" size="icon" aria-label={`Move ${sectionTitle(section, sectionIndex)} down`} disabled={locked || sectionIndex === sections.length - 1} onClick={() => setSections((current) => moveItem(current, sectionIndex, 1))}><ArrowDown className="h-4 w-4" /></EButton>
                        </span>
                        {isOpen ? (
                          <EInput
                            aria-label="Section name"
                            className="h-9 min-w-0 flex-1 sm:max-w-[16rem]"
                            value={String(section.label ?? section.title ?? "")}
                            onChange={(event) => patchSection(sectionIndex, section.title !== undefined && section.label === undefined ? { title: event.target.value } : { label: event.target.value })}
                          />
                        ) : (
                          <span className="min-w-0 flex-1 text-[0.875rem] font-[600]">{sectionTitle(section, sectionIndex)}</span>
                        )}
                        <span className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{fields.length} criteria</span>
                        <span className="ml-auto flex items-center gap-2">
                          {isOpen && canWrite ? (
                            <EConfirmButton ariaLabel={`Remove section ${sectionTitle(section, sectionIndex)}`} confirmLabel="Remove?" className="min-h-9 px-2 text-[0.8125rem] text-[hsl(var(--e-danger))]" onConfirm={() => setSections((current) => current.filter((_, i) => i !== sectionIndex))}>
                              Remove section…
                            </EConfirmButton>
                          ) : null}
                          <button type="button" aria-expanded={isOpen} className="min-h-9 px-1 text-[0.8125rem] font-[550] text-[hsl(var(--e-primary))] underline" onClick={() => setOpen((current) => ({ ...current, [sectionIndex]: !isOpen }))}>
                            {isOpen ? "Close" : "Open"}
                          </button>
                        </span>
                      </div>
                      {isOpen ? (
                        <div className="overflow-x-auto" role="region" aria-label={`Criteria of ${sectionTitle(section, sectionIndex)}`}>
                          <table className="w-full min-w-[38rem] text-left text-[0.8125rem]">
                            <thead className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                              <tr className="border-b border-[hsl(var(--e-border))]">
                                <th scope="col" className={CELL}><span className="sr-only">Order</span></th>
                                <th scope="col" className={CELL}>Criterion</th>
                                <th scope="col" className={CELL}>Type</th>
                                <th scope="col" className={CELL}>Weight</th>
                                <th scope="col" className={CELL}>Max</th>
                                <th scope="col" className={CELL}>Options</th>
                                <th scope="col" className={CELL}>Required</th>
                                <th scope="col" className={CELL}><span className="sr-only">Remove</span></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[hsl(var(--e-border))]">
                              {fields.map((field, fieldIndex) => {
                                const type = String(field.type ?? "rating");
                                const label = String(field.label ?? `Criterion ${fieldIndex + 1}`);
                                const types = CRITERION_TYPES.some((entry) => entry.value === type) ? CRITERION_TYPES : [{ value: type, label: type }, ...CRITERION_TYPES];
                                return (
                                  <tr key={String(field.id ?? fieldIndex)}>
                                    <td className={CELL}>
                                      <span className="flex">
                                        <EButton type="button" variant="ghost" size="icon" aria-label={`Move ${label} up`} disabled={locked || fieldIndex === 0} onClick={() => moveField(sectionIndex, fieldIndex, -1)}><ArrowUp className="h-3.5 w-3.5" /></EButton>
                                        <EButton type="button" variant="ghost" size="icon" aria-label={`Move ${label} down`} disabled={locked || fieldIndex === fields.length - 1} onClick={() => moveField(sectionIndex, fieldIndex, 1)}><ArrowDown className="h-3.5 w-3.5" /></EButton>
                                      </span>
                                    </td>
                                    <td className={CELL}><EInput aria-label="Criterion" className="h-9 min-w-[9rem]" value={String(field.label ?? "")} onChange={(event) => patchField(sectionIndex, fieldIndex, { label: event.target.value })} /></td>
                                    <td className={CELL}>
                                      <ESelect aria-label={`Type of ${label}`} className="h-9 w-[6.75rem]" value={type} onChange={(event) => patchField(sectionIndex, fieldIndex, { type: event.target.value })}>
                                        {types.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                                      </ESelect>
                                    </td>
                                    <td className={CELL}>
                                      {isScorable(field) || fieldWeight(field) !== null ? (
                                        <EInput aria-label={`Weight of ${label}`} type="number" min={0} step="0.5" className="h-9 w-[3.5rem]" value={fieldWeight(field) ?? ""} onChange={(event) => setScore(sectionIndex, fieldIndex, "weight", event.target.value)} />
                                      ) : <span className="whitespace-nowrap text-[0.75rem] text-[hsl(var(--e-text-faint))]">Not used</span>}
                                    </td>
                                    <td className={CELL}>
                                      {isScorable(field) ? (
                                        <EInput aria-label={`Max of ${label}`} type="number" min={0} className="h-9 w-[3.5rem]" value={fieldMax(field) ?? ""} onChange={(event) => setScore(sectionIndex, fieldIndex, "max", event.target.value)} />
                                      ) : <span className="whitespace-nowrap text-[0.75rem] text-[hsl(var(--e-text-faint))]">Not used</span>}
                                    </td>
                                    <td className={CELL}>
                                      {hasOptions(field) ? (
                                        <EInput
                                          aria-label={`Options of ${label}, comma separated`}
                                          className="h-9 min-w-[7rem]"
                                          value={optionWords(field).join(", ")}
                                          onChange={(event) => patchField(sectionIndex, fieldIndex, { options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean) })}
                                        />
                                      ) : <span className="whitespace-nowrap text-[0.75rem] text-[hsl(var(--e-text-faint))]">Not used</span>}
                                    </td>
                                    <td className={CELL}>
                                      <input type="checkbox" aria-label={`${label} is required`} className="h-5 w-5 accent-[hsl(var(--e-primary))]" checked={field.required === true} onChange={(event) => patchField(sectionIndex, fieldIndex, { required: event.target.checked })} />
                                    </td>
                                    <td className={CELL}>
                                      {canWrite ? (
                                        <EConfirmButton ariaLabel={`Remove ${label}`} confirmLabel="Remove?" onConfirm={() => setSections((current) => current.map((row, i) => (i === sectionIndex ? { ...row, fields: (row.fields ?? []).filter((_, j) => j !== fieldIndex) } : row)))}>
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </EConfirmButton>
                                      ) : null}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {canWrite ? (
                            <button
                              type="button"
                              className="m-2 min-h-9 px-2 text-[0.8125rem] font-[550] text-[hsl(var(--e-primary))] underline"
                              onClick={() => patchSection(sectionIndex, { fields: [...fields, { id: newId("field"), label: "New criterion", type: "rating", weight: 1, max: 5 }] })}
                            >
                              + Add criterion
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {canWrite ? (
                  <button
                    type="button"
                    className="min-h-9 text-[0.8125rem] font-[550] text-[hsl(var(--e-primary))] underline"
                    onClick={() => {
                      setSections((current) => [...current, { id: newId("section"), label: "New section", fields: [] }]);
                      setOpen((current) => ({ ...current, [sections.length]: true }));
                    }}
                  >
                    <Plus className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />Add section
                  </button>
                ) : null}
              </div>
            )}
          </fieldset>

          {error ? (
            <div role="alert" className={cn("mt-3 rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem]", toneNoticeClass("problem"))}>
              <p>{error}</p>
              {conflict ? (
                <EButton size="sm" variant="outline" className="mt-2" onClick={() => { onSaved(conflict, null); setConflict(null); }}>
                  Load their version
                </EButton>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--e-border))] pt-3">
            <p className="min-w-0 flex-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
              {canWrite ? (dirty ? "Unsaved changes. Leaving keeps the draft until you open another template." : "No unsaved changes.") : "Read only."}
            </p>
            <div className="flex gap-2 max-sm:w-full">
              <EButton variant="outline" disabled={saving} onClick={dirty && canWrite ? discard : onClose} className="max-sm:flex-1">{dirty && canWrite ? "Discard" : "Close"}</EButton>
              {canWrite ? (
                <EButton disabled={saving || !dirty} onClick={() => void save()} className="max-sm:flex-1">
                  {saving ? "Saving…" : nextRevision === null ? "Save" : `Save as revision ${nextRevision}`}
                </EButton>
              ) : null}
            </div>
          </div>
        </ECard>

        <div className="min-w-0 space-y-3">
          <ECard className="p-4">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h4 className="text-[0.875rem] font-[600]">As the inspector sees it</h4>
              <span className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Preview</span>
            </div>
            <QaTemplatePreviewBody schema={previewSchema} compact />
          </ECard>
          <ECard className="space-y-2 p-4 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            <p><b className="text-[hsl(var(--e-foreground))]">Raw JSON.</b> For a template whose schema has no sections array only raw editing is possible. Invalid JSON is not saved and the error names the line.</p>
          </ECard>
        </div>
      </div>
    </section>
  );
}
