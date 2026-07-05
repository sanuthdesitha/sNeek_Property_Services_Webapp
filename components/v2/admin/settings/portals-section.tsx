"use client";

import { useState } from "react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EToggle, ESaveStatus, ESectionHeading, useSaveStatus } from "./estate-form";

/**
 * Client + cleaner portal visibility toggles. Each flag PATCHes under the
 * identical key v1 uses (clientPortalVisibility.* / cleanerPortalVisibility.*).
 * Field lists mirror settings-editor.tsx exactly.
 */
export type PortalsSettings = {
  clientPortalVisibility: Record<string, boolean>;
  cleanerPortalVisibility: Record<string, boolean>;
};

const CLIENT_FIELDS: Array<[string, string]> = [
  ["showProperties", "Show properties"],
  ["showJobs", "Show jobs"],
  ["showCalendar", "Show calendar"],
  ["showReports", "Show reports"],
  ["showReportDownloads", "Allow report PDF downloads"],
  ["showChecklistPreview", "Show checklist preview"],
  ["showInventory", "Show inventory"],
  ["showShopping", "Show shopping"],
  ["showStockRuns", "Show stock count runs"],
  ["showFinanceDetails", "Show finance details"],
  ["showOngoingJobs", "Show ongoing jobs"],
  ["showLaundryUpdates", "Show laundry updates"],
  ["showLaundryImages", "Show laundry images"],
  ["showLaundryCosts", "Show laundry costs"],
  ["showClientTaskRequests", "Allow client task requests"],
  ["showCases", "Show cases/issues"],
  ["showExtraPayRequests", "Show extra pay requests"],
  ["showQuoteRequests", "Show quote requests"],
  ["showApprovals", "Show approval requests"],
  ["showCleanerNames", "Show cleaner names to client"],
  ["allowInventoryThresholdEdits", "Allow client inventory threshold edits"],
  ["allowStockRuns", "Allow client stock count runs"],
  ["allowCaseReplies", "Allow client case replies"],
];

const CLEANER_FIELDS: Array<[string, string]> = [
  ["showJobs", "Show jobs"],
  ["showCalendar", "Show calendar"],
  ["showShopping", "Show shopping"],
  ["showStockRuns", "Show stock count runs"],
  ["showInvoices", "Show invoices"],
  ["showPayRequests", "Show pay requests"],
  ["showLostFound", "Show lost and found"],
];

function ToggleGrid({
  fields,
  values,
  fallback,
  onChange,
  readOnly,
}: {
  fields: Array<[string, string]>;
  values: Record<string, boolean>;
  fallback: boolean;
  onChange: (key: string, value: boolean) => void;
  readOnly: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map(([key, label]) => (
        <div
          key={key}
          className="flex items-center justify-between gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] px-3 py-2.5"
        >
          <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{label}</span>
          <EToggle
            checked={values?.[key] ?? fallback}
            onChange={(v) => onChange(key, v)}
            disabled={readOnly}
          />
        </div>
      ))}
    </div>
  );
}

export function PortalsSection({ initial, readOnly }: { initial: PortalsSettings; readOnly: boolean }) {
  const [form, setForm] = useState<PortalsSettings>(initial);
  const [saving, setSaving] = useState(false);
  const { status, flash } = useSaveStatus();

  function setClient(key: string, value: boolean) {
    setForm((p) => ({ ...p, clientPortalVisibility: { ...p.clientPortalVisibility, [key]: value } }));
  }
  function setCleaner(key: string, value: boolean) {
    setForm((p) => ({ ...p, cleanerPortalVisibility: { ...p.cleanerPortalVisibility, [key]: value } }));
  }

  async function save() {
    if (readOnly) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientPortalVisibility: form.clientPortalVisibility,
          cleanerPortalVisibility: form.cleanerPortalVisibility,
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

  return (
    <div className="space-y-6">
      <ESectionHeading
        eyebrow="Access"
        title="Portal visibility"
        description="Control what each portal shows. Hidden sections are removed from navigation."
      />

      <ECard className="p-6">
        <p className="mb-4 text-[0.8125rem] font-medium text-[hsl(var(--e-foreground))]">Client portal</p>
        <ToggleGrid
          fields={CLIENT_FIELDS}
          values={form.clientPortalVisibility}
          fallback={false}
          onChange={setClient}
          readOnly={readOnly}
        />
      </ECard>

      <ECard className="p-6">
        <p className="mb-4 text-[0.8125rem] font-medium text-[hsl(var(--e-foreground))]">Cleaner portal</p>
        <ToggleGrid
          fields={CLEANER_FIELDS}
          values={form.cleanerPortalVisibility}
          fallback={false}
          onChange={setCleaner}
          readOnly={readOnly}
        />
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
