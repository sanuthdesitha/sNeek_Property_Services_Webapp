"use client";

/**
 * ESTATE v2 form builder — the native Estate rebuild of the v1
 * components/forms/form-builder.tsx. Two/three-pane layout: field palette (L),
 * canvas (C), properties panel (R), with a theme drawer and a read-only live
 * preview toggle. Same data model + endpoints as v1:
 *   PATCH  /api/admin/form-templates/[id]        (save draft)
 *   POST   /api/admin/form-templates/[id]/publish (publish / archive)
 *   POST   /api/admin/form-templates/[id]/duplicate
 * Reorder is button-driven (no HTML5 drag-drop). No imports from
 * @/components/{admin,ui,shared,forms}/** or @/app/admin/**.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Eye,
  LayoutList,
  Layers,
  ListChecks,
  Camera,
  Palette,
  X,
} from "lucide-react";
import type { FormField, FormFieldType, FormSchema } from "@/lib/forms/types";
import { getFieldTypeDef, isUploadFieldType } from "@/lib/forms/field-types";
import { isStandardSectionId, standardSectionDeleteWarning } from "@/lib/forms/standard-sections";
import { lintTemplateSchema, type LintIssue } from "@/lib/forms/lint-template";
import { EButton, EBadge, EEyebrow } from "@/components/v2/ui/primitives";
import { EInput, ESelect, EConfirmModal } from "@/components/v2/admin/estate-kit";
import { FieldPalette } from "./field-palette";
import { BuilderCanvas } from "./builder-canvas";
import { PropertiesPanel } from "./properties-panel";
import { ThemeEditor } from "./theme-editor";
import { FormPreview } from "./form-preview";
import { DIVIDER_LABEL } from "./blocks";

/* Job service types — must match the Prisma JobType enum (see v1 new page). */
const SERVICE_TYPES: ReadonlyArray<readonly [string, string]> = [
  ["AIRBNB_TURNOVER", "Airbnb Turnover"],
  ["DEEP_CLEAN", "Deep Clean"],
  ["END_OF_LEASE", "End of Lease"],
  ["GENERAL_CLEAN", "General Clean"],
  ["POST_CONSTRUCTION", "Post-Construction"],
  ["PRESSURE_WASH", "Pressure Wash"],
  ["WINDOW_CLEAN", "Window Clean"],
  ["LAWN_MOWING", "Lawn Mowing"],
  ["SPECIAL_CLEAN", "Special Clean"],
  ["COMMERCIAL_RECURRING", "Commercial Recurring"],
  ["CARPET_STEAM_CLEAN", "Carpet Steam Clean"],
  ["MOLD_TREATMENT", "Mold Treatment"],
  ["UPHOLSTERY_CLEANING", "Upholstery Cleaning"],
  ["TILE_GROUT_CLEANING", "Tile & Grout Cleaning"],
  ["GUTTER_CLEANING", "Gutter Cleaning"],
  ["SPRING_CLEANING", "Spring Cleaning"],
];

function newFieldId() {
  return `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Fresh ids always; the "(copy)" label suffix only when duplicating a single
 * field, where the twin sits next to its original and needs telling apart.
 * Duplicating a whole SECTION keeps every field label as-is — the section
 * title already carries the "(copy)" marker, and suffixing 20 items inside
 * just creates 20 labels someone has to clean up by hand.
 */
function duplicateField(field: FormField, opts?: { keepLabel?: boolean }): FormField {
  return {
    ...(JSON.parse(JSON.stringify(field)) as FormField),
    id: newFieldId(),
    label: opts?.keepLabel ? field.label : `${field.label} (copy)`,
    children: field.children?.map((child) => ({ ...(JSON.parse(JSON.stringify(child)) as FormField), id: newFieldId() })),
  };
}

function makeField(type: FormFieldType): FormField {
  return {
    id: newFieldId(),
    type,
    label: `New ${getFieldTypeDef(type)?.label ?? type} field`,
    ...(getFieldTypeDef(type)?.defaultConfig ?? {}),
  };
}

export interface EstateFormBuilderProps {
  templateId: string;
  initialName: string;
  initialKind: string;
  initialServiceType: string;
  initialVersion: number;
  initialSchema: FormSchema;
  initialIsActive: boolean;
  initialArchived: boolean;
}

export function EstateFormBuilder({
  templateId,
  initialName,
  initialKind,
  initialServiceType,
  initialVersion,
  initialSchema,
  initialIsActive,
  initialArchived,
}: EstateFormBuilderProps) {
  const router = useRouter();
  const [name, setName] = React.useState(initialName);
  const [serviceType, setServiceType] = React.useState(initialServiceType);
  const [schema, setSchema] = React.useState<FormSchema>(initialSchema);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isActive, setIsActive] = React.useState(initialIsActive);
  const [archived, setArchived] = React.useState(initialArchived);
  const [selectedFieldId, setSelectedFieldId] = React.useState<string | null>(null);
  const [showPreview, setShowPreview] = React.useState(false);
  const [showTheme, setShowTheme] = React.useState(false);
  // Standard sections (arrival evidence / exceptions / sign-off) carry the
  // template's evidence gates — deleting one is confirmed, never silent.
  const [pendingRemoveSectionId, setPendingRemoveSectionId] = React.useState<string | null>(null);
  const [showLint, setShowLint] = React.useState(true);

  const mutate = React.useCallback((fn: (s: FormSchema) => FormSchema) => {
    setSchema((prev) => fn(prev));
    setDirty(true);
  }, []);

  /* ── selected field lookup ── */
  const selected = React.useMemo(() => {
    if (!selectedFieldId) return null;
    for (const section of schema.sections) {
      const field = section.fields.find((f) => f.id === selectedFieldId);
      if (field) return { section, field };
    }
    return null;
  }, [selectedFieldId, schema.sections]);

  /* ── stats ── */
  const flatFields = schema.sections.flatMap((s) => s.fields.flatMap((f) => [f, ...(f.children ?? [])]));
  const totalFields = flatFields.length;
  const requiredPhotoCount = flatFields.reduce((sum, f) => {
    if (!isUploadFieldType(f.type)) return sum;
    if (f.required) return sum + Math.max(1, f.minPhotos ?? 1);
    return sum + (f.minPhotos ?? 0);
  }, 0);
  const allFields = flatFields.map((f) => ({ id: f.id, label: f.label }));

  /* ── governance lint (duplicate ids, dangling conditionals, legacy shapes) ── */
  const lintIssues = React.useMemo<LintIssue[]>(() => lintTemplateSchema(schema), [schema]);
  const blockingIssues = lintIssues.filter((i) => i.severity === "error");
  const warningIssues = lintIssues.filter((i) => i.severity === "warning");

  /* ── section ops ── */
  function addSection() {
    mutate((s) => ({ ...s, sections: [...s.sections, { id: `s-${Date.now()}`, title: "New section", fields: [] }] }));
  }
  function removeSection(sectionId: string) {
    // A standard section is template-owned but load-bearing: confirm first.
    if (isStandardSectionId(sectionId)) {
      setPendingRemoveSectionId(sectionId);
      return;
    }
    commitRemoveSection(sectionId);
  }
  function commitRemoveSection(sectionId: string) {
    mutate((s) => ({ ...s, sections: s.sections.filter((x) => x.id !== sectionId) }));
    if (selected?.section.id === sectionId) setSelectedFieldId(null);
  }
  function duplicateSection(sectionId: string) {
    mutate((s) => {
      const idx = s.sections.findIndex((x) => x.id === sectionId);
      if (idx === -1) return s;
      const src = s.sections[idx];
      const copy = {
        ...(JSON.parse(JSON.stringify(src)) as typeof src),
        id: `s-${Date.now()}`,
        title: `${src.title} (copy)`,
        fields: src.fields.map((f) => duplicateField(f, { keepLabel: true })),
      };
      const sections = s.sections.slice();
      sections.splice(idx + 1, 0, copy);
      return { ...s, sections };
    });
  }
  function moveSection(sectionId: string, dir: -1 | 1) {
    mutate((s) => {
      const idx = s.sections.findIndex((x) => x.id === sectionId);
      const to = idx + dir;
      if (idx === -1 || to < 0 || to >= s.sections.length) return s;
      return { ...s, sections: arrayMove(s.sections, idx, to) };
    });
  }
  function updateSectionTitle(sectionId: string, title: string) {
    mutate((s) => ({ ...s, sections: s.sections.map((x) => (x.id === sectionId ? { ...x, title } : x)) }));
  }
  function updateSectionDescription(sectionId: string, description: string) {
    mutate((s) => ({
      ...s,
      sections: s.sections.map((x) => (x.id === sectionId ? { ...x, description: description || undefined } : x)),
    }));
  }

  /* ── field ops ── */
  function addField(sectionId: string, type: FormFieldType = "text") {
    const field = makeField(type);
    mutate((s) => ({ ...s, sections: s.sections.map((x) => (x.id === sectionId ? { ...x, fields: [...x.fields, field] } : x)) }));
    setSelectedFieldId(field.id);
  }
  function addBlock(kind: "heading" | "divider") {
    const targetId = selected?.section.id ?? schema.sections[0]?.id;
    if (!targetId) {
      addSection();
      return;
    }
    const field: FormField =
      kind === "heading"
        ? { id: newFieldId(), type: "instruction", label: "Section heading", helpText: "Add a short instruction or note here." }
        : { id: newFieldId(), type: "instruction", label: DIVIDER_LABEL };
    mutate((s) => ({ ...s, sections: s.sections.map((x) => (x.id === targetId ? { ...x, fields: [...x.fields, field] } : x)) }));
    setSelectedFieldId(field.id);
  }
  function quickAdd(type: FormFieldType) {
    const targetId = selected?.section.id ?? schema.sections[0]?.id;
    if (!targetId) {
      addSection();
      return;
    }
    addField(targetId, type);
  }
  function updateField(sectionId: string, field: FormField) {
    mutate((s) => ({
      ...s,
      sections: s.sections.map((x) =>
        x.id === sectionId ? { ...x, fields: x.fields.map((f) => (f.id === selected?.field.id ? field : f)) } : x
      ),
    }));
    // Keep selection pointing at the (possibly re-keyed) field.
    if (selected && field.id !== selected.field.id) setSelectedFieldId(field.id);
  }
  function removeField(sectionId: string, fieldId: string) {
    mutate((s) => ({
      ...s,
      sections: s.sections.map((x) => (x.id === sectionId ? { ...x, fields: x.fields.filter((f) => f.id !== fieldId) } : x)),
    }));
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
  }
  function duplicateFieldInSection(sectionId: string, fieldId: string) {
    mutate((s) => ({
      ...s,
      sections: s.sections.map((x) => {
        if (x.id !== sectionId) return x;
        const idx = x.fields.findIndex((f) => f.id === fieldId);
        if (idx === -1) return x;
        const fields = x.fields.slice();
        fields.splice(idx + 1, 0, duplicateField(x.fields[idx]));
        return { ...x, fields };
      }),
    }));
  }
  function moveField(sectionId: string, fieldId: string, dir: -1 | 1) {
    mutate((s) => ({
      ...s,
      sections: s.sections.map((x) => {
        if (x.id !== sectionId) return x;
        const idx = x.fields.findIndex((f) => f.id === fieldId);
        const to = idx + dir;
        if (idx === -1 || to < 0 || to >= x.fields.length) return x;
        return { ...x, fields: arrayMove(x.fields, idx, to) };
      }),
    }));
  }

  /* ── persistence ── */
  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/form-templates/${templateId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, serviceType, schema }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Save failed (${res.status})`);
      }
      setSavedAt(new Date());
      setDirty(false);
    } catch (err: any) {
      setError(err?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish() {
    setError(null);
    const action = isActive ? "archive" : "publish";
    try {
      const res = await fetch(`/api/admin/form-templates/${templateId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Action failed (${res.status})`);
      }
      const { template } = await res.json();
      setIsActive(Boolean(template?.isActive));
      setArchived(Boolean(template?.archivedAt));
    } catch (err: any) {
      setError(err?.message ?? "Publish failed");
    }
  }

  return (
    <div className="flex h-[calc(100vh-var(--e-shell-top,7rem))] min-h-[36rem] flex-col">
      {/* ── Top bar ── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[hsl(var(--e-border))] pb-3">
        <EButton variant="ghost" size="icon" asChild aria-label="Back to forms">
          <Link href="/v2/admin/forms">
            <ArrowLeft className="size-4" />
          </Link>
        </EButton>

        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 sm:max-w-xs sm:flex-1">
            <EEyebrow className="mb-0.5">Template · {initialKind} · v{initialVersion}</EEyebrow>
            <EInput
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
              placeholder="Template name"
              className="text-[1rem] font-semibold"
              aria-label="Template name"
            />
          </div>
          <div className="hidden items-center gap-3 text-[0.75rem] text-[hsl(var(--e-text-faint))] lg:flex">
            <span className="inline-flex items-center gap-1">
              <Layers className="size-3.5" /> {schema.sections.length}
            </span>
            <span className="inline-flex items-center gap-1">
              <ListChecks className="size-3.5" /> {totalFields}
            </span>
            <span className="inline-flex items-center gap-1">
              <Camera className="size-3.5" /> {requiredPhotoCount}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {archived ? (
            <EBadge tone="neutral" soft>
              Archived
            </EBadge>
          ) : isActive ? (
            <EBadge tone="success" soft>
              Published
            </EBadge>
          ) : (
            <EBadge tone="warning" soft>
              Draft
            </EBadge>
          )}
          {dirty ? (
            <EBadge tone="warning" soft>
              Unsaved
            </EBadge>
          ) : savedAt ? (
            <EBadge tone="success" soft>
              Saved
            </EBadge>
          ) : null}

          <EButton variant={showPreview ? "gold" : "outline"} size="sm" onClick={() => setShowPreview((p) => !p)}>
            {showPreview ? <LayoutList className="size-4" /> : <Eye className="size-4" />}
            {showPreview ? "Editor" : "Preview"}
          </EButton>
          <EButton variant="outline" size="sm" onClick={() => setShowTheme(true)}>
            <Palette className="size-4" /> Theme
          </EButton>
          <EButton variant="outline" size="sm" onClick={togglePublish}>
            {isActive ? "Archive" : "Publish"}
          </EButton>
          <EButton size="sm" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save draft"}
          </EButton>
        </div>
      </div>

      {/* Service type row */}
      <div className="flex items-center gap-3 border-b border-[hsl(var(--e-border))] py-2">
        <span className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Service type</span>
        <ESelect
          value={serviceType}
          onChange={(e) => {
            setServiceType(e.target.value);
            setDirty(true);
          }}
          className="h-8 max-w-xs text-[0.8125rem]"
        >
          {SERVICE_TYPES.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </ESelect>
      </div>

      {error ? (
        <p className="mt-2 rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger-soft))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-foreground))]">
          {error}
        </p>
      ) : null}

      {/* ── Template lint: blocking errors + advisory warnings ── */}
      {lintIssues.length > 0 && showLint ? (
        <div
          className={`mt-2 rounded-[var(--e-radius)] border-l-[3px] px-3 py-2 ${
            blockingIssues.length > 0
              ? "border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger-soft))]"
              : "border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))]"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-[0.8125rem] font-[600] text-[hsl(var(--e-foreground))]">
              {blockingIssues.length > 0
                ? `${blockingIssues.length} blocking issue${blockingIssues.length === 1 ? "" : "s"}`
                : `${warningIssues.length} warning${warningIssues.length === 1 ? "" : "s"}`}
              {blockingIssues.length > 0 && warningIssues.length > 0
                ? ` · ${warningIssues.length} warning${warningIssues.length === 1 ? "" : "s"}`
                : ""}
            </p>
            <button
              type="button"
              onClick={() => setShowLint(false)}
              className="text-[0.75rem] text-[hsl(var(--e-text-secondary))] hover:underline"
            >
              Hide
            </button>
          </div>
          <ul className="mt-1 space-y-0.5">
            {lintIssues.slice(0, 12).map((issue, i) => (
              <li
                key={`${issue.rule}-${issue.fieldId ?? issue.sectionId ?? i}`}
                className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]"
              >
                <span className="font-[600] text-[hsl(var(--e-foreground))]">
                  {issue.severity === "error" ? "Error" : "Warning"}
                </span>{" "}
                — {issue.message}
              </li>
            ))}
            {lintIssues.length > 12 ? (
              <li className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                …and {lintIssues.length - 12} more.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {/* ── Body ── */}
      {showPreview ? (
        <div className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--e-surface-sunken))] p-4 md:p-8">
          <p className="mb-3 text-center text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-text-faint))]">
            Live preview — what the cleaner sees (read-only)
          </p>
          <FormPreview schema={schema} name={name} />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_340px]">
          <aside className="hidden border-r border-[hsl(var(--e-border))] lg:block">
            <FieldPalette onAdd={quickAdd} onAddBlock={addBlock} />
          </aside>

          <main
            className="min-h-0 overflow-y-auto bg-[hsl(var(--e-surface-sunken))] p-4 md:p-6"
            onClick={(e) => {
              if (e.target === e.currentTarget) setSelectedFieldId(null);
            }}
          >
            <BuilderCanvas
              schema={schema}
              selectedFieldId={selectedFieldId}
              onSelectField={setSelectedFieldId}
              onUpdateSectionTitle={updateSectionTitle}
              onUpdateSectionDescription={updateSectionDescription}
              onAddSection={addSection}
              onRemoveSection={removeSection}
              onDuplicateSection={duplicateSection}
              onMoveSection={moveSection}
              onAddField={addField}
              onRemoveField={removeField}
              onDuplicateField={duplicateFieldInSection}
              onMoveField={moveField}
            />
          </main>

          <aside className="hidden border-l border-[hsl(var(--e-border))] lg:block">
            {selected ? (
              <PropertiesPanel
                key={selected.field.id}
                field={selected.field}
                onUpdate={(field) => updateField(selected.section.id, field)}
                onRemove={() => removeField(selected.section.id, selected.field.id)}
                onDuplicate={() => duplicateFieldInSection(selected.section.id, selected.field.id)}
                availableFields={allFields.filter((f) => f.id !== selected.field.id)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <LayoutList className="size-8 text-[hsl(var(--e-text-faint))]" />
                <p className="text-[0.875rem] font-[550] text-[hsl(var(--e-foreground))]">No field selected</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                  Select a field in the canvas to edit its properties here.
                </p>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Mobile properties panel */}
      {!showPreview && selected ? (
        <div className="border-t border-[hsl(var(--e-border))] lg:hidden">
          <div className="max-h-[55vh] overflow-y-auto">
            <PropertiesPanel
              key={`m-${selected.field.id}`}
              field={selected.field}
              onUpdate={(field) => updateField(selected.section.id, field)}
              onRemove={() => removeField(selected.section.id, selected.field.id)}
              onDuplicate={() => duplicateFieldInSection(selected.section.id, selected.field.id)}
              availableFields={allFields.filter((f) => f.id !== selected.field.id)}
            />
          </div>
        </div>
      ) : null}

      {/* Standard-section delete confirmation */}
      <EConfirmModal
        open={Boolean(pendingRemoveSectionId)}
        onClose={() => setPendingRemoveSectionId(null)}
        title="Remove standard section"
        description={
          pendingRemoveSectionId ? standardSectionDeleteWarning(pendingRemoveSectionId) : undefined
        }
        confirmLabel="Remove section"
        danger
        onConfirm={() => {
          if (pendingRemoveSectionId) commitRemoveSection(pendingRemoveSectionId);
          setPendingRemoveSectionId(null);
        }}
      />

      {/* Theme drawer */}
      {showTheme ? (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-[hsl(160_18%_8%/0.45)] backdrop-blur-[2px]" onClick={() => setShowTheme(false)} />
          <div className="relative z-10 h-full w-full max-w-md overflow-y-auto border-l border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] shadow-[var(--e-elevation-3)]">
            <div className="flex items-center justify-between border-b border-[hsl(var(--e-border))] px-5 py-4">
              <div>
                <EEyebrow>Appearance</EEyebrow>
                <h2 className="e-display-sm">Form theme</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowTheme(false)}
                aria-label="Close"
                className="flex size-8 items-center justify-center rounded-full border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))]"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="px-5 py-5">
              <ThemeEditor theme={schema.theme} onChange={(theme) => mutate((s) => ({ ...s, theme }))} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
