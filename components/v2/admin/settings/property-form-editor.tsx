"use client";

/**
 * Settings › Operations › Property form (board "Property form", 2026-11-17).
 * Saves to PUT /api/admin/settings/property-form (the `propertyFormConfig`
 * AppSetting). It does NOT rebuild the property form: it decides which system
 * fields are required, optional or hidden (switches: shown or hidden), the
 * conditions that show a field, and the office's own custom fields (office
 * only: never shown to cleaners). The create form reads the same config.
 *
 * One unsaved-changes bar at the top lists every change; changed rows are
 * tinted and labelled. Every control locks while saving and the saved version
 * from the server replaces the screen; a failed save keeps the changes and the
 * bar. The save carries the revision it was loaded at, so a save on top of
 * someone else's answers 409 with an explicit "Load their version". Leaving
 * with changes asks first (tier A). Without write access the form and the
 * preview are shown with no controls.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Lock, Plus } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { toneNoticeClass, toneRowCellClass } from "@/components/v2/ui/tone-band";
import { EConfirmButton, EField, EInput, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import { ConditionEditor } from "@/components/v2/admin/forms/builder/condition-editor";
import { cn } from "@/lib/utils";
import { PROPERTY_FIELD_GROUPS, PROPERTY_SYSTEM_FIELDS } from "@/lib/property-form/fields";
import {
  CUSTOM_FIELD_TYPES,
  sanitizePropertyFormConfig,
  type CustomFieldDef,
  type CustomFieldType,
  type PropertyFormConfig,
} from "@/lib/property-form/config";
import type { FieldCondition } from "@/lib/forms/types";
import {
  CUSTOM_TYPE_LABELS,
  GROUP_LABEL,
  GROUP_PREVIEW_ROWS,
  STATE_LABEL,
  conditionSentence,
  describeChanges,
  newCustomFieldId,
  overrideForState,
  previewGroups,
  systemFieldChanged,
  systemStateOf,
  type SystemState,
} from "./property-form-model";

type SaveResponse = PropertyFormConfig & { revision?: string | null; error?: string; current?: PropertyFormConfig & { revision?: string | null } };

function Segmented({ options, value, onChange, disabled, label }: { options: ReadonlyArray<{ key: SystemState; label: string }>; value: SystemState; onChange: (value: SystemState) => void; disabled: boolean; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))]">
      {options.map((option, index) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={value === option.key}
          disabled={disabled}
          onClick={() => onChange(option.key)}
          className={cn(
            "min-h-9 px-3 text-[0.8125rem] font-[550] max-sm:min-h-11 max-sm:flex-1",
            index > 0 && "border-l border-[hsl(var(--e-border))]",
            value === option.key ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]" : "text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-surface-raised))]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ConditionLine({
  condition,
  labels,
  onChange,
  targets,
  canWrite,
  alwaysWord,
}: {
  condition: FieldCondition | undefined;
  labels: ReadonlyMap<string, string>;
  onChange: (next: FieldCondition | undefined) => void;
  targets: Array<{ id: string; label: string }>;
  canWrite: boolean;
  alwaysWord?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const sentence = conditionSentence(condition, labels);
  if (!sentence && !alwaysWord && !open) {
    // Rows without a condition stay one line: the link is small and quiet.
    return canWrite ? (
      <button type="button" className="text-[0.6875rem] text-[hsl(var(--e-text-secondary))] underline decoration-dotted hover:text-[hsl(var(--e-primary))]" onClick={() => setOpen(true)}>
        Add a condition
      </button>
    ) : null;
  }
  return (
    <div className="space-y-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
      <p>
        {sentence ?? "Always shown"}
        {canWrite ? (
          <>
            {" · "}
            <button type="button" aria-expanded={open} className="font-[550] text-[hsl(var(--e-primary))] underline" onClick={() => setOpen((value) => !value)}>
              {open ? "Done" : sentence ? "Change" : "Add a condition"}
            </button>
          </>
        ) : null}
      </p>
      {open && canWrite ? <ConditionEditor condition={condition} onChange={onChange} availableFields={targets} /> : null}
    </div>
  );
}

export function PropertyFormEditor({ initialConfig, initialRevision = null, canWrite = true }: { initialConfig: PropertyFormConfig; initialRevision?: string | null; canWrite?: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = React.useState<PropertyFormConfig>(initialConfig);
  const [revision, setRevision] = React.useState<string | null>(initialRevision);
  const [draft, setDraft] = React.useState<PropertyFormConfig>(initialConfig);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState<(PropertyFormConfig & { revision: string | null }) | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [deleteIndex, setDeleteIndex] = React.useState<number | null>(null);
  const [leaveHref, setLeaveHref] = React.useState<string | null>(null);

  const changes = React.useMemo(() => describeChanges(saved, draft), [saved, draft]);
  const dirty = changes.length > 0;
  const savedIds = React.useMemo(() => new Set(saved.customFields.map((field) => field.id)), [saved]);
  const labels = React.useMemo(
    () => new Map<string, string>([...PROPERTY_SYSTEM_FIELDS.map((field) => [field.id, field.label] as [string, string]), ...draft.customFields.map((field) => [field.id, field.label || field.id] as [string, string])]),
    [draft.customFields],
  );
  const targets = React.useMemo(() => Array.from(labels, ([id, label]) => ({ id, label })), [labels]);
  const locked = !canWrite || saving;

  // Leaving with unsaved changes: the browser asks on reload or close; links inside the app ask with a tier A dialog.
  React.useEffect(() => {
    if (!dirty || !canWrite) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaveHref(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty, canWrite]);

  function setState(id: string, state: SystemState) {
    setDraft((current) => ({ ...current, systemFields: { ...current.systemFields, [id]: overrideForState(state, current.systemFields[id]) } }));
  }
  function setCondition(id: string, condition: FieldCondition | undefined) {
    setDraft((current) => ({ ...current, systemFields: { ...current.systemFields, [id]: { ...current.systemFields[id], conditional: condition } } }));
  }
  function patchCustom(index: number, patch: Partial<CustomFieldDef>) {
    setDraft((current) => ({ ...current, customFields: current.customFields.map((field, i) => (i === index ? { ...field, ...patch } : field)) }));
  }
  function moveCustom(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.customFields.length) return current;
      const next = current.customFields.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, customFields: next };
    });
  }
  function removeCustom(index: number) {
    setDraft((current) => ({ ...current, customFields: current.customFields.filter((_, i) => i !== index) }));
  }

  function adopt(config: PropertyFormConfig, nextRevision: string | null) {
    const clean = sanitizePropertyFormConfig(config);
    setSaved(clean);
    setDraft(clean);
    setRevision(nextRevision);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/admin/settings/property-form", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: draft, expectedRevision: revision }),
      });
      const body = (await response.json().catch(() => ({}))) as SaveResponse;
      if (response.status === 409 && body.current) {
        setConflict({ ...sanitizePropertyFormConfig(body.current), revision: body.current.revision ?? null });
        setError(`The property form was not saved: ${body.error ?? "someone else saved it first."}`);
        return;
      }
      if (!response.ok) {
        setError(`The property form was not saved: ${body.error ?? `the server answered ${response.status}`}.`);
        return;
      }
      // The saved version from the server replaces the screen.
      adopt(body, body.revision ?? null);
      setConflict(null);
      setStatus("Property form saved. New properties use it from now on.");
    } catch {
      setError("The property form was not saved: the server could not be reached.");
    } finally {
      setSaving(false);
    }
  }

  const deleting = deleteIndex !== null ? draft.customFields[deleteIndex] : null;
  const preview = previewGroups(draft, labels);

  return (
    <div className="min-w-0 space-y-4" data-unsaved={dirty && canWrite ? "true" : undefined}>
      {dirty && canWrite ? (
        <div className={cn("sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-[var(--e-radius-lg)] px-4 py-3 text-[0.8125rem] shadow-[var(--e-elevation-1)]", toneNoticeClass("attention"))}>
          <p className="min-w-0 flex-1">
            <b>{changes.length} unsaved change{changes.length === 1 ? "" : "s"}</b>
            <span className="ml-2">{changes.map((change) => change.text).join(" · ")}</span>
          </p>
          <div className="flex gap-2 max-sm:w-full">
            <EButton size="sm" variant="outline" disabled={saving} onClick={() => { setDraft(saved); setError(null); }} className="max-sm:flex-1">Discard</EButton>
            <EButton size="sm" disabled={saving} onClick={() => void save()} className="max-sm:flex-1">{saving ? "Saving…" : "Save form"}</EButton>
          </div>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className={cn("rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem]", toneNoticeClass("problem"))}>
          <p>{error} Your changes are still here.</p>
          {conflict ? (
            <EButton size="sm" variant="outline" className="mt-2" onClick={() => { adopt(conflict, conflict.revision); setConflict(null); setError(null); }}>
              Load their version (drops your changes)
            </EButton>
          ) : null}
        </div>
      ) : null}
      {status ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-success))]">{status}</p> : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <fieldset disabled={locked} className="min-w-0 space-y-4">
          <legend className="sr-only">{canWrite ? "Property form fields" : "Property form fields (read only)"}</legend>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            <span><EPill tone="ok">Required</EPill> must be filled</span>
            <span><EPill>Optional</EPill> shown, may be blank</span>
            <span><EPill>Hidden</EPill> not on the form</span>
            <span className="inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" aria-hidden="true" /> Always required: client, name, address and suburb keep maps and billing working.</span>
          </div>

          {PROPERTY_FIELD_GROUPS.map((group) => {
            const fields = PROPERTY_SYSTEM_FIELDS.filter((field) => field.group === group.id);
            const lockedFields = fields.filter((field) => field.locked);
            const editable = fields.filter((field) => !field.locked);
            if (fields.length === 0) return null;
            const isOpen = expanded[group.id] === true || editable.some((field) => systemFieldChanged(field.id, saved, draft));
            const shown = isOpen ? editable : editable.slice(0, GROUP_PREVIEW_ROWS);
            const rest = editable.slice(shown.length);
            return (
              <ECard key={group.id} className="min-w-0 overflow-hidden p-0">
                <div className="p-4 pb-3">
                  <h3 className="text-[0.9375rem] font-[600]">{GROUP_LABEL[group.id] ?? group.label}</h3>
                  <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                    {fields.length} field{fields.length === 1 ? "" : "s"}{lockedFields.length ? ` · ${lockedFields.length} always required` : ""}
                  </p>
                </div>
                <ul className="divide-y divide-[hsl(var(--e-border))] border-t border-[hsl(var(--e-border))]">
                  {lockedFields.length > 0 ? (
                    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[0.875rem]">
                      <span className="min-w-0">{lockedFields.map((field) => field.label).join(" · ")}</span>
                      <span className="inline-flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]"><Lock className="h-3.5 w-3.5" aria-hidden="true" /> Always required</span>
                    </li>
                  ) : null}
                  {shown.map((def) => {
                    const state = systemStateOf(def, draft.systemFields[def.id]);
                    const changed = systemFieldChanged(def.id, saved, draft);
                    const options = def.supportsRequired
                      ? (["required", "optional", "hidden"] as SystemState[]).map((key) => ({ key, label: STATE_LABEL[key] }))
                      : [{ key: "optional" as SystemState, label: "Shown" }, { key: "hidden" as SystemState, label: "Hidden" }];
                    return (
                      <li key={def.id} className={cn("space-y-1 px-4 py-2.5", changed && toneRowCellClass("attention"))}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="min-w-0 text-[0.875rem]">
                            {def.label}
                            {!def.supportsRequired ? <span className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]"> · a switch, cannot be required</span> : null}
                            {changed ? <EPill tone="warn" className="ml-2">Changed</EPill> : null}
                          </span>
                          {canWrite ? (
                            <Segmented label={`${def.label}: required, optional or hidden`} options={options} value={state} onChange={(next) => setState(def.id, next)} disabled={locked} />
                          ) : (
                            <EPill tone={state === "required" ? "ok" : "neutral"}>{def.supportsRequired ? STATE_LABEL[state] : state === "hidden" ? "Hidden" : "Shown"}</EPill>
                          )}
                        </div>
                        {state !== "hidden" && (canWrite || draft.systemFields[def.id]?.conditional) ? (
                          <ConditionLine
                            condition={draft.systemFields[def.id]?.conditional}
                            labels={labels}
                            onChange={(next) => setCondition(def.id, next)}
                            targets={targets.filter((target) => target.id !== def.id)}
                            canWrite={canWrite && !saving}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                  {rest.length > 0 ? (
                    <li className="flex items-center justify-between gap-2 px-4 py-3 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                      <span className="min-w-0">{rest.length} more: {rest.map((field) => field.label.toLowerCase()).join(", ")}</span>
                      <button type="button" className="min-h-11 shrink-0 font-[600] text-[hsl(var(--e-primary))] underline" onClick={() => setExpanded((current) => ({ ...current, [group.id]: true }))}>
                        Show
                      </button>
                    </li>
                  ) : null}
                </ul>
              </ECard>
            );
          })}

          <ECard className="min-w-0 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-[0.9375rem] font-[600]">Custom fields · {draft.customFields.length}</h3>
                <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Your own questions, saved on each property. Office only: cleaners never see them.</p>
              </div>
              {canWrite ? (
                <EButton size="sm" variant="outline" onClick={() => setDraft((current) => ({ ...current, customFields: [...current.customFields, { id: newCustomFieldId(), label: "", type: "text" }] }))}>
                  <Plus className="h-3.5 w-3.5" /> Add custom field
                </EButton>
              ) : null}
            </div>
            <div className="mt-3 space-y-3">
              {draft.customFields.length === 0 ? (
                <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">No custom fields yet. Add fields like &ldquo;Wi-Fi network&rdquo;, &ldquo;Bin day&rdquo; or a &ldquo;Has pool?&rdquo; switch that shows more questions.</p>
              ) : null}
              {draft.customFields.map((field, index) => {
                const isNew = !savedIds.has(field.id);
                const before = saved.customFields.find((row) => row.id === field.id);
                const changed = isNew || JSON.stringify(before) !== JSON.stringify(field);
                return (
                  <div key={field.id} className={cn("space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3", changed ? toneRowCellClass("attention") : "bg-[hsl(var(--e-surface-raised))]")}>
                    <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
                      <EField label={<span>Label {isNew ? <EPill tone="warn" className="ml-1">New</EPill> : null}</span>}>
                        <EInput value={field.label} onChange={(event) => patchCustom(index, { label: event.target.value })} placeholder="e.g. Bin day" className="max-sm:h-11 max-sm:text-base" />
                      </EField>
                      <EField label="Type">
                        <ESelect value={field.type} onChange={(event) => patchCustom(index, { type: event.target.value as CustomFieldType })} className="max-sm:h-11 max-sm:text-base">
                          {CUSTOM_FIELD_TYPES.map((type) => <option key={type} value={type}>{CUSTOM_TYPE_LABELS[type]}</option>)}
                        </ESelect>
                      </EField>
                      {canWrite ? (
                        <div className="flex items-center gap-1">
                          <EButton variant="ghost" size="icon" aria-label={`Move ${field.label || "field"} up`} disabled={index === 0} onClick={() => moveCustom(index, -1)}><ArrowUp className="h-4 w-4" /></EButton>
                          <EButton variant="ghost" size="icon" aria-label={`Move ${field.label || "field"} down`} disabled={index === draft.customFields.length - 1} onClick={() => moveCustom(index, 1)}><ArrowDown className="h-4 w-4" /></EButton>
                          {isNew ? (
                            <EConfirmButton ariaLabel={`Delete ${field.label || "field"}`} confirmLabel="Delete?" onConfirm={() => removeCustom(index)} className="inline-flex min-h-10 items-center px-2 text-[0.8125rem] font-[550] text-[hsl(var(--e-danger))]">
                              Delete
                            </EConfirmButton>
                          ) : (
                            <EButton variant="ghost" size="sm" className="text-[hsl(var(--e-danger))]" onClick={() => setDeleteIndex(index)}>Delete</EButton>
                          )}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <ESwitch checked={field.required === true} disabled={locked} onCheckedChange={(value) => patchCustom(index, { required: value })} label={`Required: ${field.required ? "on" : "off"}`} />
                      {field.type === "select" ? (
                        <EInput
                          aria-label={`Options for ${field.label || "field"}, comma separated`}
                          className="min-w-0 flex-1 max-sm:h-11 max-sm:text-base"
                          value={(field.options ?? []).join(", ")}
                          onChange={(event) => patchCustom(index, { options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean) })}
                          placeholder="Options, comma separated"
                        />
                      ) : (
                        <EInput
                          aria-label={`Hint for ${field.label || "field"}`}
                          className="min-w-0 flex-1 max-sm:h-11 max-sm:text-base"
                          value={field.placeholder ?? ""}
                          onChange={(event) => patchCustom(index, { placeholder: event.target.value })}
                          placeholder="Hint shown in the box (optional)"
                        />
                      )}
                    </div>
                    <ConditionLine
                      condition={field.conditional}
                      labels={labels}
                      onChange={(next) => patchCustom(index, { conditional: next })}
                      targets={targets.filter((target) => target.id !== field.id)}
                      canWrite={canWrite && !saving}
                      alwaysWord
                    />
                  </div>
                );
              })}
              <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                Types: short text, paragraph, number, dropdown, yes / no, photo upload, file upload. Deleting an unsaved field asks &ldquo;Delete?&rdquo; in place; deleting a saved one asks first and its answers stay on old properties.
              </p>
            </div>
          </ECard>
        </fieldset>

        <aside aria-labelledby="property-form-preview-heading" className="min-w-0 space-y-2 lg:sticky lg:top-20 lg:self-start">
          <div className="flex items-baseline justify-between gap-2">
            <h3 id="property-form-preview-heading" className="text-[0.9375rem] font-[600]">Preview: New property</h3>
            <span className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">as staff see it</span>
          </div>
          <ECard className="space-y-4 p-4" aria-label="Preview of the new property form">
            {preview.map((group) => (
              <div key={group.id} className="space-y-2">
                <p className="text-[0.6875rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-gold-ink))]">{group.label}</p>
                {group.fields.filter((field) => field.required || group.id === "custom").map((field) => (
                  <div key={field.id} className="space-y-1">
                    <p className="text-[0.75rem] font-[550]">
                      {field.label}{" "}
                      <span className={field.required ? "text-[hsl(var(--e-danger))]" : "font-normal text-[hsl(var(--e-text-secondary))]"}>{field.required ? "required" : "optional"}</span>
                    </p>
                    {field.kind === "switch" ? (
                      <div aria-hidden="true" className="h-6 w-10 rounded-full border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-raised))]" />
                    ) : (
                      <div aria-hidden="true" className="flex h-9 items-center rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] text-[hsl(var(--e-text-faint))]">
                        {field.kind === "select" ? "Choose ▾" : field.placeholder ?? ""}
                      </div>
                    )}
                    {field.note ? <p className="text-[0.6875rem] text-[hsl(var(--e-text-secondary))]">{field.note}</p> : null}
                  </div>
                ))}
                {group.id !== "custom" && group.fields.some((field) => !field.required) ? (
                  <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                    Optional: {group.fields.filter((field) => !field.required).map((field) => field.label).join(", ")}
                  </p>
                ) : null}
              </div>
            ))}
            <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">&ldquo;Required&rdquo; is written in words; the colour is a second signal. Hidden fields do not appear.</p>
          </ECard>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            Shows your unsaved changes. Existing properties are not changed; a newly required field is asked the next time someone edits that property. Properties › &ldquo;Missing required details&rdquo; lists the ones without it.
          </p>
        </aside>
      </div>

      <EConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleteIndex(null)}
        tier="destructive"
        title={`Delete the custom field "${deleting?.label || "Untitled field"}"?`}
        description="It leaves the property form when you save. Answers already saved on properties stay on them."
        confirmLabel="Delete field"
        onConfirm={() => {
          if (deleteIndex !== null) removeCustom(deleteIndex);
          setDeleteIndex(null);
        }}
      />
      <EConfirmDialog
        open={leaveHref !== null}
        onClose={() => setLeaveHref(null)}
        tier="ordinary"
        title={`Leave without saving ${changes.length} change${changes.length === 1 ? "" : "s"}?`}
        description="Your changes to the property form are not saved. Leaving drops them."
        confirmLabel="Leave without saving"
        onConfirm={() => {
          const href = leaveHref;
          setLeaveHref(null);
          setDraft(saved);
          if (href) router.push(href);
        }}
      />
    </div>
  );
}

