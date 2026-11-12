"use client";

/**
 * QA template editor (moved out of qa-templates-manager.tsx unchanged): the
 * name, a structured sections/criteria editor and a raw JSON mode. Saving
 * PATCHes the template; the server records the change as a new revision.
 */
import { useEffect, useState } from "react";
import { Braces, ListTree, Plus, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { EConfirmButton, EField, EInput, EModal, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import type { JobType } from "@prisma/client";

export type TemplateRow = {
  id: string;
  name: string;
  serviceType: JobType;
  version: number;
  isActive: boolean;
  propertyId: string | null;
  property?: { id: string; name: string; suburb: string } | null;
  schema: unknown;
};

export type PropertyOption = { id: string; name: string; suburb: string };

/* Loose section/field shapes — real schemas mix the simple rating shape
 * ({ weight, max } top-level) with FormSchema fields (nested scoring, options),
 * so the structured editor preserves every unknown property untouched. */
type LooseField = Record<string, unknown> & {
  id?: string;
  label?: string;
  type?: string;
  weight?: number;
  max?: number;
  options?: unknown;
  scoring?: { max?: number; weight?: number } & Record<string, unknown>;
};
type LooseSection = Record<string, unknown> & {
  id?: string;
  label?: string;
  title?: string;
  fields?: LooseField[];
};

const KNOWN_FIELD_TYPES = ["rating", "textarea", "checkbox", "upload", "radio", "select", "yesno", "photo", "text"];

function slugId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function isEditableSchema(schema: unknown): schema is { sections: LooseSection[] } {
  return (
    Boolean(schema) &&
    typeof schema === "object" &&
    Array.isArray((schema as { sections?: unknown }).sections)
  );
}

function fieldWeight(field: LooseField): string {
  const w = field.scoring && typeof field.scoring.weight === "number" ? field.scoring.weight : field.weight;
  return typeof w === "number" ? String(w) : "";
}

function fieldMax(field: LooseField): string {
  const m = field.scoring && typeof field.scoring.max === "number" ? field.scoring.max : field.max;
  return typeof m === "number" ? String(m) : "";
}


export function QaTemplateEditor({ template, onClose, onSaved }: { template: TemplateRow | null; onClose: () => void; onSaved: (revision: number | null) => void }) {
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [editName, setEditName] = useState("");
  const [schemaSections, setSchemaSections] = useState<LooseSection[]>([]);
  const [schemaExtra, setSchemaExtra] = useState<Record<string, unknown>>({});
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    if (template) openEdit(template);
    else setEditing(null);
    // Re-open only when a different template is chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id]);

  function openEdit(template: TemplateRow) {
    setEditing(template);
    setEditName(template.name);
    if (isEditableSchema(template.schema)) {
      const { sections, ...extra } = template.schema as { sections: LooseSection[] } & Record<string, unknown>;
      setSchemaSections(JSON.parse(JSON.stringify(sections)));
      setSchemaExtra(extra);
      setRawMode(false);
    } else {
      setSchemaSections([]);
      setSchemaExtra({});
      setRawMode(true);
    }
    setRawText(JSON.stringify(template.schema ?? {}, null, 2));
  }

  function buildSchemaFromEditor(): unknown {
    if (rawMode) {
      return JSON.parse(rawText);
    }
    return { ...schemaExtra, sections: schemaSections };
  }

  async function saveEdit() {
    if (!editing) return;
    let templateSchema: unknown;
    try {
      templateSchema = buildSchemaFromEditor();
    } catch {
      toast({ title: "Invalid schema JSON", description: "Fix the raw JSON before saving.", variant: "destructive" });
      return;
    }
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/admin/qa/templates/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim() || undefined, templateSchema }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Save failed", description: body.error ?? "Please retry.", variant: "destructive" });
        return;
      }
      toast({ title: "QA template updated", description: typeof body.revision === "number" ? `Saved as revision ${body.revision}.` : undefined });
      setEditing(null);
      onSaved(typeof body.revision === "number" ? body.revision : null);
    } finally {
      setSavingEdit(false);
    }
  }

  /* ── Structured schema editor helpers ── */
  function patchSection(index: number, patch: Partial<LooseSection>) {
    setSchemaSections((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }
  function removeSection(index: number) {
    setSchemaSections((prev) => prev.filter((_, i) => i !== index));
  }
  function addSection() {
    setSchemaSections((prev) => [...prev, { id: slugId("section"), label: "New section", fields: [] }]);
  }
  function patchField(sectionIndex: number, fieldIndex: number, patch: Partial<LooseField>) {
    setSchemaSections((prev) =>
      prev.map((section, i) => {
        if (i !== sectionIndex) return section;
        const fields = (section.fields ?? []).map((f, j) => (j === fieldIndex ? { ...f, ...patch } : f));
        return { ...section, fields };
      })
    );
  }
  function setFieldScore(sectionIndex: number, fieldIndex: number, key: "weight" | "max", raw: string) {
    setSchemaSections((prev) =>
      prev.map((section, i) => {
        if (i !== sectionIndex) return section;
        const fields = (section.fields ?? []).map((f, j) => {
          if (j !== fieldIndex) return f;
          const value = raw === "" ? undefined : Number(raw);
          const next: LooseField = { ...f };
          if (next.scoring && typeof next.scoring === "object") {
            next.scoring = { ...next.scoring, [key]: value };
          } else {
            next[key] = value;
          }
          return next;
        });
        return { ...section, fields };
      })
    );
  }
  function removeField(sectionIndex: number, fieldIndex: number) {
    setSchemaSections((prev) =>
      prev.map((section, i) =>
        i === sectionIndex
          ? { ...section, fields: (section.fields ?? []).filter((_, j) => j !== fieldIndex) }
          : section
      )
    );
  }
  function addField(sectionIndex: number) {
    setSchemaSections((prev) =>
      prev.map((section, i) =>
        i === sectionIndex
          ? {
              ...section,
              fields: [
                ...(section.fields ?? []),
                { id: slugId("field"), label: "New criterion", type: "rating", weight: 1, max: 5 },
              ],
            }
          : section
      )
    );
  }

  const structuredOk = editing ? isEditableSchema(editing.schema) : false;
  const close = () => {
    setEditing(null);
    onClose();
  };

  return (
      <EModal
        open={Boolean(editing)}
        onClose={close}
        eyebrow="QA templates"
        title={editing ? `Edit — ${editing.name}` : "Edit template"}
        size="xl"
      >
        {editing ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <EField label="Template name" className="min-w-[16rem] flex-1">
                <EInput value={editName} onChange={(e) => setEditName(e.target.value)} />
              </EField>
              <div className="flex items-center gap-2 pb-0.5">
                <EButton
                  size="sm"
                  variant={rawMode ? "outline" : "primary"}
                  disabled={!structuredOk}
                  onClick={() => {
                    if (rawMode) {
                      // Re-enter structured mode from the raw text if it parses.
                      try {
                        const parsed = JSON.parse(rawText);
                        if (!isEditableSchema(parsed)) throw new Error("no sections");
                        const { sections, ...extra } = parsed as { sections: LooseSection[] } & Record<string, unknown>;
                        setSchemaSections(sections);
                        setSchemaExtra(extra);
                        setRawMode(false);
                      } catch {
                        toast({ title: "Raw JSON must be valid and contain a sections array.", variant: "destructive" });
                      }
                    }
                  }}
                >
                  <ListTree className="h-3.5 w-3.5" /> Sections
                </EButton>
                <EButton
                  size="sm"
                  variant={rawMode ? "primary" : "outline"}
                  onClick={() => {
                    if (!rawMode) {
                      setRawText(JSON.stringify({ ...schemaExtra, sections: schemaSections }, null, 2));
                      setRawMode(true);
                    }
                  }}
                >
                  <Braces className="h-3.5 w-3.5" /> Raw JSON
                </EButton>
              </div>
            </div>

            {rawMode ? (
              <EField label="Schema JSON" hint={structuredOk ? undefined : "This schema has no sections array, so only raw editing is available."}>
                <ETextarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  className="min-h-[20rem] font-mono text-[0.75rem]"
                  spellCheck={false}
                />
              </EField>
            ) : (
              <div className="space-y-3">
                {schemaSections.map((section, sectionIndex) => (
                  <div
                    key={String(section.id ?? sectionIndex)}
                    className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3"
                  >
                    <div className="flex items-end gap-2">
                      <EField label="Section" className="flex-1">
                        <EInput
                          value={String(section.label ?? section.title ?? "")}
                          onChange={(e) =>
                            patchSection(
                              sectionIndex,
                              section.title !== undefined && section.label === undefined
                                ? { title: e.target.value }
                                : { label: e.target.value }
                            )
                          }
                        />
                      </EField>
                      {/* Low tier for both removals in this editor: they only
                          change the draft schema held in this dialog — nothing
                          reaches the template until "Save template" — and a
                          second dialog stacked on this one would be worse than
                          the risk it guards. */}
                      <EConfirmButton
                        ariaLabel="Remove section"
                        confirmLabel="Remove?"
                        className="inline-flex h-8 items-center gap-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] px-2 text-[0.75rem] text-[hsl(var(--e-danger))]"
                        onConfirm={() => removeSection(sectionIndex)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </EConfirmButton>
                    </div>

                    <div className="space-y-2">
                      {(section.fields ?? []).map((field, fieldIndex) => {
                        const type = String(field.type ?? "rating");
                        const typeOptions = KNOWN_FIELD_TYPES.includes(type)
                          ? KNOWN_FIELD_TYPES
                          : [type, ...KNOWN_FIELD_TYPES];
                        const scorable = type === "rating" || (field.scoring && typeof field.scoring === "object");
                        const hasOptions = Array.isArray(field.options);
                        return (
                          <div
                            key={String(field.id ?? fieldIndex)}
                            className="grid items-end gap-2 rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] p-2 sm:grid-cols-[1fr_8rem_4.5rem_4.5rem_auto]"
                          >
                            <EField label="Criterion">
                              <EInput
                                className="h-9"
                                value={String(field.label ?? "")}
                                onChange={(e) => patchField(sectionIndex, fieldIndex, { label: e.target.value })}
                              />
                            </EField>
                            <EField label="Type">
                              <ESelect
                                className="h-9"
                                value={type}
                                onChange={(e) => patchField(sectionIndex, fieldIndex, { type: e.target.value })}
                              >
                                {typeOptions.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </ESelect>
                            </EField>
                            {scorable ? (
                              <>
                                <EField label="Weight">
                                  <EInput
                                    className="h-9"
                                    type="number"
                                    min={0}
                                    step="0.5"
                                    value={fieldWeight(field)}
                                    onChange={(e) => setFieldScore(sectionIndex, fieldIndex, "weight", e.target.value)}
                                  />
                                </EField>
                                <EField label="Max">
                                  <EInput
                                    className="h-9"
                                    type="number"
                                    min={0}
                                    value={fieldMax(field)}
                                    onChange={(e) => setFieldScore(sectionIndex, fieldIndex, "max", e.target.value)}
                                  />
                                </EField>
                              </>
                            ) : (
                              <div className="sm:col-span-2" />
                            )}
                            <div className="flex items-center justify-end pb-0.5">
                              <EConfirmButton
                                ariaLabel="Remove criterion"
                                confirmLabel="Remove?"
                                onConfirm={() => removeField(sectionIndex, fieldIndex)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </EConfirmButton>
                            </div>
                            {hasOptions ? (
                              <div className="sm:col-span-5">
                                <EField label="Options" hint="Comma separated answer options.">
                                  <EInput
                                    className="h-9"
                                    value={(field.options as unknown[])
                                      .map((o) =>
                                        typeof o === "object" && o !== null
                                          ? String((o as { label?: unknown; value?: unknown }).label ?? (o as { value?: unknown }).value ?? "")
                                          : String(o)
                                      )
                                      .join(", ")}
                                    onChange={(e) =>
                                      patchField(sectionIndex, fieldIndex, {
                                        options: e.target.value
                                          .split(",")
                                          .map((s) => s.trim())
                                          .filter(Boolean),
                                      })
                                    }
                                  />
                                </EField>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                      <EButton size="sm" variant="outline" onClick={() => addField(sectionIndex)}>
                        <Plus className="h-3.5 w-3.5" /> Add criterion
                      </EButton>
                    </div>
                  </div>
                ))}
                <EButton size="sm" variant="outline" onClick={addSection}>
                  <Plus className="h-3.5 w-3.5" /> Add section
                </EButton>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
              <EButton variant="outline" size="sm" onClick={close} disabled={savingEdit}>
                Cancel
              </EButton>
              <EButton variant="gold" size="sm" onClick={() => void saveEdit()} disabled={savingEdit}>
                {savingEdit ? "Saving…" : "Save template"}
              </EButton>
            </div>
          </div>
        ) : null}
      </EModal>

  );
}
