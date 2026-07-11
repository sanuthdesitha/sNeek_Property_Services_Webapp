"use client";

/**
 * Settings → Pricing variables. Admin editor for the configurable pricing
 * variables stored in AppSettings.pricingVariables. Add / edit / remove
 * variables and their options, set defaults, toggle required / allow-custom.
 * Saves the whole array via PATCH /api/admin/settings.
 */
import { useState } from "react";
import { Plus, Pencil, Trash2, GripVertical } from "lucide-react";
import { EButton, ECard, EBadge, EEmptyState } from "@/components/v2/ui/primitives";
import { EModal } from "@/components/v2/admin/estate-kit";
import {
  EField,
  EInput,
  ESelectNative,
  EToggle,
  ESaveStatus,
  ESectionHeading,
  useSaveStatus,
} from "./estate-form";
import type {
  PricingVariable,
  PricingOption,
  PricingVariableKind,
  PricingAdjustType,
} from "@/lib/pricing/variables";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function blankOption(): PricingOption {
  return { id: uid("opt"), label: "New option", adjustType: "none", adjustValue: 0 };
}

function blankVariable(): PricingVariable {
  const optA = blankOption();
  return {
    id: uid("var"),
    label: "New variable",
    kind: "select",
    required: false,
    allowCustom: false,
    defaultOptionId: optA.id,
    options: [optA, { ...blankOption(), label: "Second option" }],
  };
}

function adjustSummary(opt: PricingOption): string {
  if (opt.adjustType === "none" || !opt.adjustValue) return "no change";
  if (opt.adjustType === "percent") return `${opt.adjustValue > 0 ? "+" : ""}${opt.adjustValue}%`;
  return `${opt.adjustValue > 0 ? "+$" : "-$"}${Math.abs(opt.adjustValue)}`;
}

export function PricingVariablesSection({
  initial,
  readOnly,
}: {
  initial: PricingVariable[];
  readOnly: boolean;
}) {
  const [variables, setVariables] = useState<PricingVariable[]>(initial ?? []);
  const [editing, setEditing] = useState<PricingVariable | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const { status, flash } = useSaveStatus();

  function openAdd() {
    setEditing(blankVariable());
    setIsNew(true);
  }

  function openEdit(variable: PricingVariable) {
    // Deep clone so cancel discards edits.
    setEditing(JSON.parse(JSON.stringify(variable)) as PricingVariable);
    setIsNew(false);
  }

  function removeVariable(id: string) {
    setVariables((prev) => prev.filter((v) => v.id !== id));
  }

  function commitEditing(next: PricingVariable) {
    // Normalise id from label if left as the generated placeholder-only.
    const normalised: PricingVariable = { ...next };
    if (isNew) {
      const slug = slugify(normalised.label);
      normalised.id = slug ? `${slug}_${normalised.id.split("_").pop()}` : normalised.id;
    }
    setVariables((prev) => {
      const idx = prev.findIndex((v) => v.id === editing?.id);
      if (idx === -1) return [...prev, normalised];
      const copy = [...prev];
      copy[idx] = normalised;
      return copy;
    });
    setEditing(null);
    setIsNew(false);
  }

  async function save() {
    if (readOnly) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pricingVariables: variables }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash("error", body.error ?? "Could not save settings.");
        return;
      }
      flash("saved", "Pricing variables saved");
    } catch {
      flash("error", "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <ESectionHeading
        eyebrow="Pricing"
        title="Pricing variables"
        description="Admin-defined adjustments layered onto a quote's base price — property condition, location/zone, parking, stairs, pets, access and more. Each variable has a default option; percent adjustments apply to the base amount."
        actions={
          !readOnly ? (
            <EButton size="sm" variant="outline-gold" onClick={openAdd}>
              <Plus className="h-4 w-4" /> Add variable
            </EButton>
          ) : null
        }
      />

      {variables.length === 0 ? (
        <EEmptyState
          eyebrow="Nothing configured"
          title="No pricing variables"
          description="Add a variable to let quotes adjust for condition, location, access and other factors."
          action={
            !readOnly ? (
              <EButton size="sm" onClick={openAdd}>
                <Plus className="h-4 w-4" /> Add variable
              </EButton>
            ) : null
          }
        />
      ) : (
        <div className="space-y-4">
          {variables.map((variable) => (
            <ECard key={variable.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <GripVertical className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
                    <span className="text-[0.9375rem] font-semibold">{variable.label}</span>
                    <EBadge tone="neutral" soft>
                      {variable.kind}
                    </EBadge>
                    {variable.required ? (
                      <EBadge tone="gold" soft>
                        required
                      </EBadge>
                    ) : null}
                    {variable.allowCustom ? (
                      <EBadge tone="info" soft>
                        custom allowed
                      </EBadge>
                    ) : null}
                  </div>

                  {variable.kind === "number" ? (
                    <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                      Per {variable.unitLabel || "unit"}:{" "}
                      {variable.unitAdjustType === "percent"
                        ? `${variable.unitAdjustValue ?? 0}%`
                        : `$${variable.unitAdjustValue ?? 0}`}{" "}
                      each
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {(variable.options ?? []).map((opt) => (
                        <span
                          key={opt.id}
                          className="rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] px-2 py-0.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]"
                        >
                          {opt.label}
                          <span className="text-[hsl(var(--e-text-faint))]">
                            {" · "}
                            {adjustSummary(opt)}
                          </span>
                          {opt.id === variable.defaultOptionId ? (
                            <span className="ml-1 text-[hsl(var(--e-gold-ink))]">default</span>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  )}

                  {variable.note ? (
                    <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">{variable.note}</p>
                  ) : null}
                </div>

                {!readOnly ? (
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <EButton size="icon" variant="ghost" onClick={() => openEdit(variable)} aria-label="Edit">
                      <Pencil className="h-4 w-4" />
                    </EButton>
                    <EButton
                      size="icon"
                      variant="ghost"
                      onClick={() => removeVariable(variable.id)}
                      aria-label="Remove"
                    >
                      <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
                    </EButton>
                  </div>
                ) : null}
              </div>
            </ECard>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <ESaveStatus status={status} />
        {!readOnly ? (
          <EButton onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </EButton>
        ) : (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">
            Read-only — administrator access required to edit.
          </p>
        )}
      </div>

      {editing ? (
        <VariableEditorModal
          key={editing.id}
          variable={editing}
          isNew={isNew}
          onCancel={() => {
            setEditing(null);
            setIsNew(false);
          }}
          onSave={commitEditing}
        />
      ) : null}
    </div>
  );
}

const KIND_OPTIONS: { value: PricingVariableKind; label: string }[] = [
  { value: "select", label: "Select (choose one option)" },
  { value: "boolean", label: "Boolean (on / off)" },
  { value: "number", label: "Number (per-unit amount)" },
];

const ADJUST_OPTIONS: { value: PricingAdjustType; label: string }[] = [
  { value: "none", label: "No change" },
  { value: "flat", label: "Flat $" },
  { value: "percent", label: "Percent %" },
];

function VariableEditorModal({
  variable,
  isNew,
  onCancel,
  onSave,
}: {
  variable: PricingVariable;
  isNew: boolean;
  onCancel: () => void;
  onSave: (variable: PricingVariable) => void;
}) {
  const [draft, setDraft] = useState<PricingVariable>(variable);

  function patch(changes: Partial<PricingVariable>) {
    setDraft((prev) => ({ ...prev, ...changes }));
  }

  function patchOption(optId: string, changes: Partial<PricingOption>) {
    setDraft((prev) => ({
      ...prev,
      options: (prev.options ?? []).map((o) => (o.id === optId ? { ...o, ...changes } : o)),
    }));
  }

  function addOption() {
    setDraft((prev) => ({ ...prev, options: [...(prev.options ?? []), blankOption()] }));
  }

  function removeOption(optId: string) {
    setDraft((prev) => {
      const options = (prev.options ?? []).filter((o) => o.id !== optId);
      const defaultOptionId =
        prev.defaultOptionId === optId ? options[0]?.id : prev.defaultOptionId;
      return { ...prev, options, defaultOptionId };
    });
  }

  const isChoiceKind = draft.kind === "select" || draft.kind === "boolean";

  return (
    <EModal
      open
      onClose={onCancel}
      eyebrow={isNew ? "New variable" : "Edit variable"}
      title={draft.label || "Pricing variable"}
      size="xl"
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <EField label="Label">
            <EInput
              value={draft.label}
              onChange={(e) => patch({ label: e.target.value })}
              placeholder="e.g. Property condition"
            />
          </EField>
          <EField label="Kind">
            <ESelectNative
              value={draft.kind}
              onChange={(e) => patch({ kind: e.target.value as PricingVariableKind })}
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </ESelectNative>
          </EField>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <EToggle
            checked={!!draft.required}
            onChange={(v) => patch({ required: v })}
            label="Required"
            description="Operator must make a choice."
          />
          <EToggle
            checked={!!draft.allowCustom}
            onChange={(v) => patch({ allowCustom: v })}
            label="Allow custom value"
            description="Operator can type an 'other' value."
          />
        </div>

        <EField label="Note (optional)" hint="Shown to the operator, e.g. a conditional-display hint.">
          <EInput
            value={draft.note ?? ""}
            onChange={(e) => patch({ note: e.target.value })}
            placeholder="e.g. Shown when parking is paid."
          />
        </EField>

        {isChoiceKind ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-text-secondary))]">
                Options
              </p>
              <EButton size="sm" variant="ghost" onClick={addOption}>
                <Plus className="h-4 w-4" /> Add option
              </EButton>
            </div>

            <div className="space-y-3">
              {(draft.options ?? []).map((opt) => (
                <div
                  key={opt.id}
                  className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3"
                >
                  <div className="grid items-end gap-3 sm:grid-cols-[1fr_9rem_7rem_auto]">
                    <EField label="Option label">
                      <EInput
                        value={opt.label}
                        onChange={(e) => patchOption(opt.id, { label: e.target.value })}
                      />
                    </EField>
                    <EField label="Adjust">
                      <ESelectNative
                        value={opt.adjustType}
                        onChange={(e) =>
                          patchOption(opt.id, { adjustType: e.target.value as PricingAdjustType })
                        }
                      >
                        {ADJUST_OPTIONS.map((a) => (
                          <option key={a.value} value={a.value}>
                            {a.label}
                          </option>
                        ))}
                      </ESelectNative>
                    </EField>
                    <EField label={opt.adjustType === "percent" ? "Value (%)" : "Value ($)"}>
                      <EInput
                        type="number"
                        step="0.01"
                        value={String(opt.adjustValue)}
                        disabled={opt.adjustType === "none"}
                        onChange={(e) =>
                          patchOption(opt.id, { adjustValue: Number(e.target.value) || 0 })
                        }
                      />
                    </EField>
                    <div className="flex items-center gap-2 pb-1">
                      <label className="flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                        <input
                          type="radio"
                          name={`default-${draft.id}`}
                          checked={draft.defaultOptionId === opt.id}
                          onChange={() => patch({ defaultOptionId: opt.id })}
                        />
                        Default
                      </label>
                      <EButton
                        size="icon"
                        variant="ghost"
                        onClick={() => removeOption(opt.id)}
                        aria-label="Remove option"
                      >
                        <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
                      </EButton>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <EField label="Adjust per unit">
              <ESelectNative
                value={draft.unitAdjustType ?? "flat"}
                onChange={(e) => patch({ unitAdjustType: e.target.value as "flat" | "percent" })}
              >
                <option value="flat">Flat $</option>
                <option value="percent">Percent %</option>
              </ESelectNative>
            </EField>
            <EField label="Value per unit">
              <EInput
                type="number"
                step="0.01"
                value={String(draft.unitAdjustValue ?? 0)}
                onChange={(e) => patch({ unitAdjustValue: Number(e.target.value) || 0 })}
              />
            </EField>
            <EField label="Unit label" hint="e.g. $, hour, level">
              <EInput
                value={draft.unitLabel ?? ""}
                onChange={(e) => patch({ unitLabel: e.target.value })}
                placeholder="$"
              />
            </EField>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-[hsl(var(--e-border))] pt-4">
          <EButton variant="ghost" onClick={onCancel}>
            Cancel
          </EButton>
          <EButton onClick={() => onSave(draft)} disabled={!draft.label.trim()}>
            {isNew ? "Add variable" : "Update variable"}
          </EButton>
        </div>
      </div>
    </EModal>
  );
}
