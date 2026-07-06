"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import {
  EField,
  EInput,
  EToggle,
  ESaveStatus,
  ESectionHeading,
  useSaveStatus,
} from "./estate-form";

/**
 * Laundry portal controls + operational defaults + location dropdowns. Keys
 * mirror settings-editor.tsx: laundryPortalVisibility.*, laundryOperations.*,
 * laundryBagLocationOptions[], laundryDropoffLocationOptions[]. Same
 * add/remove + dedupe behaviour as v1, PATCHed with identical keys.
 */
export type LaundrySettings = {
  laundryPortalVisibility: Record<string, boolean>;
  laundryOperations: {
    pickupCutoffTime: string;
    defaultPickupTime: string;
    defaultDropoffTime: string;
    maxOutdoorDays: number;
    fastReturnWhenNoNextClean: boolean;
    fastReturnDaysWhenNoNextClean: number;
  };
  laundryBagLocationOptions: string[];
  laundryDropoffLocationOptions: string[];
};

const PORTAL_FIELDS: Array<[string, string]> = [
  ["showCalendar", "Show calendar"],
  ["showInvoices", "Show invoices"],
  ["showHistoryTab", "Show history tab"],
  ["showCostTracking", "Show laundry cost tracking"],
  ["showPickupPhoto", "Allow pickup photo"],
  ["showSkipReasons", "Show skip reasons and cleaner notes"],
  ["requireDropoffPhoto", "Require drop-off photo"],
  ["requireEarlyDropoffReason", "Require reason for early drop-off"],
];

function normalizeOptionLabel(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function dedupeOptionList(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = normalizeOptionLabel(raw);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function LocationList({
  label,
  placeholder,
  options,
  onAdd,
  onRemove,
  readOnly,
}: {
  label: string;
  placeholder: string;
  options: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  readOnly: boolean;
}) {
  const [draft, setDraft] = useState("");
  return (
    <EField label={label}>
      <div className="flex gap-2">
        <EInput
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          disabled={readOnly}
        />
        <EButton
          variant="outline"
          size="sm"
          onClick={() => {
            onAdd(draft);
            setDraft("");
          }}
          disabled={readOnly || !draft.trim()}
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </EButton>
      </div>
      <div className="mt-2 flex min-h-12 flex-wrap gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
        {options.length === 0 ? (
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">No options yet.</p>
        ) : (
          options.map((option) => (
            <span
              key={option}
              className="inline-flex items-center gap-1 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-1 text-[0.75rem]"
            >
              {option}
              {!readOnly ? (
                <button
                  type="button"
                  onClick={() => onRemove(option)}
                  className="text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
                  aria-label={`Remove ${option}`}
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </span>
          ))
        )}
      </div>
    </EField>
  );
}

export function LaundrySection({ initial, readOnly }: { initial: LaundrySettings; readOnly: boolean }) {
  const [form, setForm] = useState<LaundrySettings>(initial);
  const [saving, setSaving] = useState(false);
  const { status, flash } = useSaveStatus();

  function setPortal(key: string, value: boolean) {
    setForm((p) => ({ ...p, laundryPortalVisibility: { ...p.laundryPortalVisibility, [key]: value } }));
  }
  function setOps<K extends keyof LaundrySettings["laundryOperations"]>(
    key: K,
    value: LaundrySettings["laundryOperations"][K]
  ) {
    setForm((p) => ({ ...p, laundryOperations: { ...p.laundryOperations, [key]: value } }));
  }

  function addBag(value: string) {
    const v = normalizeOptionLabel(value);
    if (!v) return;
    setForm((p) => ({ ...p, laundryBagLocationOptions: dedupeOptionList([...p.laundryBagLocationOptions, v]) }));
  }
  function removeBag(value: string) {
    if (form.laundryBagLocationOptions.length <= 1) {
      flash("error", "At least one bag location option is required.");
      return;
    }
    setForm((p) => ({ ...p, laundryBagLocationOptions: p.laundryBagLocationOptions.filter((i) => i !== value) }));
  }
  function addDropoff(value: string) {
    const v = normalizeOptionLabel(value);
    if (!v) return;
    setForm((p) => ({
      ...p,
      laundryDropoffLocationOptions: dedupeOptionList([...p.laundryDropoffLocationOptions, v]),
    }));
  }
  function removeDropoff(value: string) {
    if (form.laundryDropoffLocationOptions.length <= 1) {
      flash("error", "At least one drop-off location option is required.");
      return;
    }
    setForm((p) => ({
      ...p,
      laundryDropoffLocationOptions: p.laundryDropoffLocationOptions.filter((i) => i !== value),
    }));
  }

  async function save() {
    if (readOnly) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          laundryPortalVisibility: form.laundryPortalVisibility,
          laundryOperations: form.laundryOperations,
          laundryBagLocationOptions: form.laundryBagLocationOptions,
          laundryDropoffLocationOptions: form.laundryDropoffLocationOptions,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash("error", body.error ?? "Could not save settings.");
        return;
      }
      flash("saved", "Settings saved");
    } catch {
      flash("error", "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  const ops = form.laundryOperations;

  return (
    <div className="space-y-6">
      <ESectionHeading
        eyebrow="Laundry"
        title="Laundry portal & operations"
        description="Laundry portal menus, operational defaults, and pickup / drop-off location lists."
      />

      <ECard className="p-6">
        <p className="mb-4 text-[0.8125rem] font-medium text-[hsl(var(--e-foreground))]">Portal controls</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {PORTAL_FIELDS.map(([key, label]) => (
            <div
              key={key}
              className="flex items-center justify-between gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] px-3 py-2.5"
            >
              <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{label}</span>
              <EToggle
                checked={form.laundryPortalVisibility?.[key] ?? false}
                onChange={(v) => setPortal(key, v)}
                disabled={readOnly}
              />
            </div>
          ))}
        </div>
      </ECard>

      <ECard className="p-6">
        <p className="mb-4 text-[0.8125rem] font-medium text-[hsl(var(--e-foreground))]">Operational defaults</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <EField label="Pickup cutoff time">
            <EInput
              type="time"
              value={ops.pickupCutoffTime}
              onChange={(e) => setOps("pickupCutoffTime", e.target.value || "10:00")}
              disabled={readOnly}
            />
          </EField>
          <EField label="Default pickup time">
            <EInput
              type="time"
              value={ops.defaultPickupTime}
              onChange={(e) => setOps("defaultPickupTime", e.target.value || "09:00")}
              disabled={readOnly}
            />
          </EField>
          <EField label="Default drop-off time">
            <EInput
              type="time"
              value={ops.defaultDropoffTime}
              onChange={(e) => setOps("defaultDropoffTime", e.target.value || "16:00")}
              disabled={readOnly}
            />
          </EField>
          <EField
            label="Fallback outdoor days (manual jobs only)"
            hint="Used when fast-return is disabled and there is no next known clean date."
          >
            <EInput
              type="number"
              min={1}
              max={14}
              value={ops.maxOutdoorDays}
              onChange={(e) => setOps("maxOutdoorDays", Number(e.target.value || ops.maxOutdoorDays))}
              disabled={readOnly}
            />
          </EField>
        </div>
        <div className="mt-5 space-y-4">
          <EToggle
            checked={ops.fastReturnWhenNoNextClean}
            onChange={(v) => setOps("fastReturnWhenNoNextClean", v)}
            disabled={readOnly}
            label="Fast return when no next clean is known"
            description="If enabled, planner returns linen quickly so you can handle last-minute bookings."
          />
          <EField label="Fast-return days after pickup">
            <EInput
              type="number"
              min={1}
              max={7}
              value={ops.fastReturnDaysWhenNoNextClean}
              onChange={(e) =>
                setOps("fastReturnDaysWhenNoNextClean", Number(e.target.value || ops.fastReturnDaysWhenNoNextClean))
              }
              disabled={readOnly || !ops.fastReturnWhenNoNextClean}
            />
          </EField>
        </div>
      </ECard>

      <ECard className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[0.8125rem] font-medium text-[hsl(var(--e-foreground))]">Location dropdowns</p>
          <div className="flex flex-wrap gap-2">
            <EButton
              variant="ghost"
              size="sm"
              onClick={() =>
                setForm((p) => ({ ...p, laundryDropoffLocationOptions: dedupeOptionList(p.laundryBagLocationOptions) }))
              }
              disabled={readOnly}
            >
              Copy bag → drop-off
            </EButton>
            <EButton
              variant="ghost"
              size="sm"
              onClick={() =>
                setForm((p) => ({ ...p, laundryBagLocationOptions: dedupeOptionList(p.laundryDropoffLocationOptions) }))
              }
              disabled={readOnly}
            >
              Copy drop-off → bag
            </EButton>
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <LocationList
            label="Bag / pickup locations"
            placeholder="Add bag location option"
            options={form.laundryBagLocationOptions}
            onAdd={addBag}
            onRemove={removeBag}
            readOnly={readOnly}
          />
          <LocationList
            label="Drop-off locations"
            placeholder="Add drop-off location option"
            options={form.laundryDropoffLocationOptions}
            onAdd={addDropoff}
            onRemove={removeDropoff}
            readOnly={readOnly}
          />
        </div>
      </ECard>

      <div className="flex items-center justify-end gap-3">
        <ESaveStatus status={status} />
        {!readOnly ? (
          <EButton onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </EButton>
        ) : (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">Read-only — administrator access required to edit.</p>
        )}
      </div>
    </div>
  );
}
