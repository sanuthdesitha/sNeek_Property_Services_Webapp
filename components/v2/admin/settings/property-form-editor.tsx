"use client";

/**
 * Admin editor for the property intake form field-config. Saves to
 * PUT /api/admin/settings/property-form (the `propertyFormConfig` AppSetting).
 * It does NOT rebuild the property form — it only decides which system fields
 * are required/optional/hidden + conditional, and defines extra custom fields.
 * The create form (property-create-form.tsx) reads the same config to render.
 */
import { useMemo, useState } from "react";
import { Lock, Plus, Trash2, ArrowUp, ArrowDown, Save, Loader2 } from "lucide-react";
import Link from "next/link";
import {
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EAlert,
  EBadge,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import { ConditionEditor } from "@/components/v2/admin/forms/builder/condition-editor";
import {
  PROPERTY_SYSTEM_FIELDS,
  PROPERTY_SYSTEM_FIELD_MAP,
  PROPERTY_FIELD_GROUPS,
} from "@/lib/property-form/fields";
import {
  CUSTOM_FIELD_TYPES,
  type CustomFieldDef,
  type CustomFieldType,
  type PropertyFormConfig,
  type SystemFieldOverride,
} from "@/lib/property-form/config";
import type { FieldCondition } from "@/lib/forms/types";

const CUSTOM_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Short text",
  longtext: "Paragraph",
  number: "Number",
  select: "Dropdown",
  yesno: "Yes / No",
  photo: "Photo upload",
  file: "File upload",
};

type SystemState = "required" | "optional" | "hidden";

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 6)}`;
}

export function PropertyFormEditor({ initialConfig }: { initialConfig: PropertyFormConfig }) {
  const [systemFields, setSystemFields] = useState<Record<string, SystemFieldOverride>>(
    () => ({ ...initialConfig.systemFields }),
  );
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>(() => [...initialConfig.customFields]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  // Fields available as condition triggers: every system field + custom field.
  const conditionTargets = useMemo(
    () => [
      ...PROPERTY_SYSTEM_FIELDS.map((f) => ({ id: f.id, label: f.label })),
      ...customFields.map((f) => ({ id: f.id, label: f.label || f.id })),
    ],
    [customFields],
  );

  function patchSystem(id: string, patch: Partial<SystemFieldOverride>) {
    setSystemFields((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function systemStateOf(id: string): SystemState {
    const def = PROPERTY_SYSTEM_FIELD_MAP[id];
    const ov = systemFields[id];
    if (ov?.hidden) return "hidden";
    if (!def.supportsRequired) return "optional";
    if (ov?.required === true) return "required";
    if (ov?.required === false) return "optional";
    return def.defaultRequired ? "required" : "optional";
  }

  function setSystemState(id: string, state: SystemState) {
    if (state === "hidden") {
      patchSystem(id, { hidden: true });
    } else if (state === "required") {
      patchSystem(id, { hidden: false, required: true });
    } else {
      patchSystem(id, { hidden: false, required: false });
    }
  }

  function setSystemCondition(id: string, condition: FieldCondition | undefined) {
    patchSystem(id, { conditional: condition });
  }

  function addCustom() {
    setCustomFields((prev) => [...prev, { id: uid("cf"), label: "New field", type: "text" }]);
  }
  function patchCustom(index: number, patch: Partial<CustomFieldDef>) {
    setCustomFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }
  function removeCustom(index: number) {
    setCustomFields((prev) => prev.filter((_, i) => i !== index));
  }
  function moveCustom(index: number, dir: -1 | 1) {
    setCustomFields((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const config: PropertyFormConfig = { version: 1, systemFields, customFields };
      const res = await fetch("/api/admin/settings/property-form", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tone: "danger", text: body.error ?? "Save failed." });
        return;
      }
      // Adopt the server-sanitised config so the UI reflects exactly what was stored.
      setSystemFields({ ...(body.systemFields ?? {}) });
      setCustomFields([...(body.customFields ?? [])]);
      setMsg({ tone: "success", text: "Property form saved. New properties use it immediately." });
    } catch (e: any) {
      setMsg({ tone: "danger", text: e?.message ?? "Network error." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[0.8125rem] text-[hsl(var(--e-text-faint))]">
          Choose which fields staff must complete when adding a property, hide the ones you don&apos;t
          use, show fields only when a condition is met, and add your own custom fields. Core fields
          (client, name, address, suburb) stay required so maps and billing keep working.
        </p>
        <EButton variant="gold" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          Save form
        </EButton>
      </div>

      {msg ? <EAlert tone={msg.tone === "success" ? "success" : "danger"} title={msg.text} /> : null}

      {/* System fields grouped by section */}
      {PROPERTY_FIELD_GROUPS.map((group) => {
        const fields = PROPERTY_SYSTEM_FIELDS.filter((f) => f.group === group.id);
        if (fields.length === 0) return null;
        return (
          <ECard key={group.id}>
            <ECardHeader className="pb-2">
              <ECardTitle className="text-[0.95rem]">{group.label}</ECardTitle>
            </ECardHeader>
            <ECardBody className="space-y-2 pt-0">
              {fields.map((def) => {
                const state = systemStateOf(def.id);
                const ov = systemFields[def.id];
                return (
                  <div
                    key={def.id}
                    className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-[0.8125rem] font-[550]">
                        {def.label}
                        {def.locked ? (
                          <EBadge tone="neutral" soft>
                            <Lock className="mr-1 h-3 w-3" /> Always required
                          </EBadge>
                        ) : null}
                      </div>
                      {!def.locked ? (
                        <div className="flex overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                          {(def.supportsRequired
                            ? (["required", "optional", "hidden"] as SystemState[])
                            : (["optional", "hidden"] as SystemState[])
                          ).map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setSystemState(def.id, opt)}
                              className={`px-3 py-1 text-[0.75rem] capitalize transition ${
                                state === opt
                                  ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                                  : "text-[hsl(var(--e-text-faint))] hover:bg-[hsl(var(--e-surface-raised))]"
                              }`}
                            >
                              {opt === "optional" && !def.supportsRequired ? "Visible" : opt}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {!def.locked && state !== "hidden" ? (
                      <div className="mt-2">
                        <ConditionEditor
                          condition={ov?.conditional}
                          onChange={(next) => setSystemCondition(def.id, next)}
                          availableFields={conditionTargets.filter((t) => t.id !== def.id)}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </ECardBody>
          </ECard>
        );
      })}

      {/* Custom fields */}
      <ECard>
        <ECardHeader className="flex flex-row items-center justify-between pb-2">
          <ECardTitle className="text-[0.95rem]">Custom fields</ECardTitle>
          <EButton variant="outline" size="sm" onClick={addCustom}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add custom field
          </EButton>
        </ECardHeader>
        <ECardBody className="space-y-3 pt-0">
          {customFields.length === 0 ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              No custom fields yet. Add fields like &ldquo;Wifi network&rdquo;, &ldquo;Bin day&rdquo;, or a
              &ldquo;Has pool?&rdquo; toggle that reveals extra questions.
            </p>
          ) : null}

          {customFields.map((field, index) => (
            <div
              key={field.id}
              className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3"
            >
              <div className="grid gap-2 sm:grid-cols-[1fr_160px_auto]">
                <EInput
                  value={field.label}
                  onChange={(e) => patchCustom(index, { label: e.target.value })}
                  placeholder="Field label"
                />
                <ESelect
                  value={field.type}
                  onChange={(e) => patchCustom(index, { type: e.target.value as CustomFieldType })}
                >
                  {CUSTOM_FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {CUSTOM_TYPE_LABELS[t]}
                    </option>
                  ))}
                </ESelect>
                <div className="flex items-center gap-1">
                  <EButton variant="ghost" size="icon" onClick={() => moveCustom(index, -1)} aria-label="Move up">
                    <ArrowUp className="h-4 w-4" />
                  </EButton>
                  <EButton variant="ghost" size="icon" onClick={() => moveCustom(index, 1)} aria-label="Move down">
                    <ArrowDown className="h-4 w-4" />
                  </EButton>
                  <EButton variant="ghost" size="icon" onClick={() => removeCustom(index)} aria-label="Delete field">
                    <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
                  </EButton>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <ESwitch
                  checked={field.required === true}
                  onCheckedChange={(v) => patchCustom(index, { required: v })}
                  label="Required"
                />
                {field.type === "select" ? (
                  <EInput
                    className="flex-1 text-[0.8125rem]"
                    value={(field.options ?? []).join(", ")}
                    onChange={(e) =>
                      patchCustom(index, {
                        options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean),
                      })
                    }
                    placeholder="Options, comma separated"
                  />
                ) : (
                  <EInput
                    className="flex-1 text-[0.8125rem]"
                    value={field.placeholder ?? ""}
                    onChange={(e) => patchCustom(index, { placeholder: e.target.value })}
                    placeholder="Placeholder / hint (optional)"
                  />
                )}
              </div>

              <ConditionEditor
                condition={field.conditional}
                onChange={(next) => patchCustom(index, { conditional: next })}
                availableFields={conditionTargets.filter((t) => t.id !== field.id)}
              />
            </div>
          ))}
        </ECardBody>
      </ECard>

      <div className="flex justify-end gap-2">
        <EButton asChild variant="outline">
          <Link href="/v2/admin/properties">Back to properties</Link>
        </EButton>
        <EButton variant="gold" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          Save form
        </EButton>
      </div>
    </div>
  );
}
