"use client";

/**
 * ESTATE QA templates — v2-native replacement for the v1 AdminQaTemplatesClient
 * (app/admin/qa/page.tsx). Same endpoints:
 *   GET   /api/admin/qa/templates          → { templates, properties, jobTypes }
 *   POST  /api/admin/qa/templates          { name?, serviceType, propertyId?, templateSchema? }
 *   PATCH /api/admin/qa/templates/[id]     { name?, isActive?, templateSchema? }
 * (No DELETE endpoint exists for QA templates — deactivate instead.)
 * Estate token scope only; no components/ui/* dependency.
 */
import { useEffect, useMemo, useState } from "react";
import { JobType } from "@prisma/client";
import { Braces, ClipboardCheck, ListTree, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { buildDefaultQaTemplateSchema, jobTypeLabel } from "@/lib/qa/templates";
import { EBadge, EButton, ECard } from "@/components/v2/ui/primitives";
import {
  EConfirmModal,
  EField,
  EInput,
  EModal,
  ESelect,
  ESwitch,
  ETableShell,
  ETextarea,
} from "@/components/v2/admin/estate-kit";

type TemplateRow = {
  id: string;
  name: string;
  serviceType: JobType;
  version: number;
  isActive: boolean;
  propertyId: string | null;
  property?: { id: string; name: string; suburb: string } | null;
  schema: unknown;
};

type PropertyOption = { id: string; name: string; suburb: string };

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

export function QaTemplatesManager() {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState<JobType>(JobType.AIRBNB_TURNOVER);
  const [createPropertyId, setCreatePropertyId] = useState("__global");
  const [creating, setCreating] = useState(false);

  // Edit modal
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [editName, setEditName] = useState("");
  const [schemaSections, setSchemaSections] = useState<LooseSection[]>([]);
  const [schemaExtra, setSchemaExtra] = useState<Record<string, unknown>>({});
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Reset-to-default confirm
  const [resetFor, setResetFor] = useState<TemplateRow | null>(null);
  const [resetting, setResetting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/qa/templates", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not load QA templates", description: body.error ?? "Please retry.", variant: "destructive" });
        return;
      }
      setTemplates(Array.isArray(body.templates) ? body.templates : []);
      setProperties(Array.isArray(body.properties) ? body.properties : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createTemplate() {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/qa/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim() || undefined,
          serviceType: createType,
          propertyId: createPropertyId === "__global" ? null : createPropertyId,
          // Omitted templateSchema → the server seeds the detailed default
          // schema for the chosen job type (same as v1's prefilled JSON).
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Template create failed", description: body.error ?? "Please retry.", variant: "destructive" });
        return;
      }
      toast({ title: "QA template created", description: "It starts from the default schema — open it to tailor sections." });
      setCreateOpen(false);
      setCreateName("");
      await load();
    } finally {
      setCreating(false);
    }
  }

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
      toast({ title: "QA template updated" });
      setEditing(null);
      await load();
    } finally {
      setSavingEdit(false);
    }
  }

  async function toggleActive(template: TemplateRow) {
    const res = await fetch(`/api/admin/qa/templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !template.isActive }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Update failed", description: body.error ?? "Please retry.", variant: "destructive" });
      return;
    }
    await load();
  }

  async function confirmReset() {
    if (!resetFor) return;
    setResetting(true);
    try {
      const res = await fetch(`/api/admin/qa/templates/${resetFor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateSchema: buildDefaultQaTemplateSchema(resetFor.serviceType) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: "Reset failed", description: body.error ?? "Please retry.", variant: "destructive" });
        return;
      }
      toast({ title: "Reset to detailed default", description: "The form now uses the latest area-based sections." });
      setResetFor(null);
      await load();
    } finally {
      setResetting(false);
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

  const sortedTemplates = useMemo(() => templates, [templates]);
  const structuredOk = editing ? isEditableSchema(editing.schema) : false;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Scoring forms QA inspectors fill in — global per job type, with optional per-property overrides.
        </p>
        <div className="flex items-center gap-2">
          <EButton size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </EButton>
          <EButton size="sm" variant="gold" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New template
          </EButton>
        </div>
      </div>

      <ECard className="overflow-hidden p-0">
        {loading ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : sortedTemplates.length === 0 ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            No QA templates yet — create one to start scoring inspections.
          </p>
        ) : (
          <ETableShell
            headers={[
              { label: "Template" },
              { label: "Job type" },
              { label: "Scope" },
              { label: "Version", align: "center" },
              { label: "Active", align: "center" },
              { label: "", align: "right" },
            ]}
          >
            {sortedTemplates.map((template) => (
              <tr key={template.id} className={template.isActive ? "" : "opacity-60"}>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-2 font-[550] text-[hsl(var(--e-foreground))]">
                    <ClipboardCheck className="h-3.5 w-3.5 text-[hsl(var(--e-gold-ink))]" />
                    {template.name}
                  </span>
                </td>
                <td className="px-4 py-3 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                  {jobTypeLabel(template.serviceType)}
                </td>
                <td className="px-4 py-3">
                  {template.property ? (
                    <EBadge tone="info" soft>
                      {template.property.name} ({template.property.suburb})
                    </EBadge>
                  ) : (
                    <EBadge tone="neutral" soft>Global default</EBadge>
                  )}
                </td>
                <td className="e-tnum px-4 py-3 text-center text-[hsl(var(--e-muted-foreground))]">
                  v{template.version}
                </td>
                <td className="px-4 py-3 text-center">
                  <ESwitch checked={template.isActive} onCheckedChange={() => void toggleActive(template)} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    <EButton size="sm" variant="outline" onClick={() => openEdit(template)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </EButton>
                    <EButton size="sm" variant="ghost" onClick={() => setResetFor(template)}>
                      <RefreshCw className="h-3.5 w-3.5" /> Reset
                    </EButton>
                  </div>
                </td>
              </tr>
            ))}
          </ETableShell>
        )}
      </ECard>

      {/* Create */}
      <EModal open={createOpen} onClose={() => setCreateOpen(false)} eyebrow="QA templates" title="New QA template">
        <div className="space-y-4">
          <EField label="Name" hint="Leave blank for an automatic name.">
            <EInput
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Default QA — Airbnb turnover"
            />
          </EField>
          <EField label="Job type">
            <ESelect value={createType} onChange={(e) => setCreateType(e.target.value as JobType)}>
              {Object.values(JobType).map((type) => (
                <option key={type} value={type}>
                  {jobTypeLabel(type)}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Property override" hint="Global templates apply everywhere; a property override wins for that property.">
            <ESelect value={createPropertyId} onChange={(e) => setCreatePropertyId(e.target.value)}>
              <option value="__global">Global default</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name} ({property.suburb})
                </option>
              ))}
            </ESelect>
          </EField>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            The template starts from the detailed default sections for the job type — edit it after creating.
          </p>
          <EButton className="w-full" variant="gold" onClick={() => void createTemplate()} disabled={creating}>
            {creating ? "Creating…" : "Create template"}
          </EButton>
        </div>
      </EModal>

      {/* Edit metadata + schema */}
      <EModal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
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
                      <EButton
                        size="sm"
                        variant="ghost"
                        className="text-[hsl(var(--e-danger))]"
                        onClick={() => removeSection(sectionIndex)}
                        aria-label="Remove section"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </EButton>
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
                              <EButton
                                size="sm"
                                variant="ghost"
                                className="text-[hsl(var(--e-danger))]"
                                onClick={() => removeField(sectionIndex, fieldIndex)}
                                aria-label="Remove criterion"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </EButton>
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
              <EButton variant="outline" size="sm" onClick={() => setEditing(null)} disabled={savingEdit}>
                Cancel
              </EButton>
              <EButton variant="gold" size="sm" onClick={() => void saveEdit()} disabled={savingEdit}>
                {savingEdit ? "Saving…" : "Save template"}
              </EButton>
            </div>
          </div>
        ) : null}
      </EModal>

      {/* Reset to default */}
      <EConfirmModal
        open={Boolean(resetFor)}
        onClose={() => setResetFor(null)}
        title={`Reset "${resetFor?.name ?? "template"}" to default?`}
        description="This replaces its scoring sections with the latest detailed default for the job type. Existing submissions are unaffected."
        confirmLabel="Reset to default"
        loading={resetting}
        onConfirm={confirmReset}
      />
    </div>
  );
}
