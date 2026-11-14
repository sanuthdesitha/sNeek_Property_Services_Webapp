"use client";

/**
 * "Report an item" from the office (board "Maintenance"). Uses the existing
 * POST /api/maintenance, which already accepts office reports (source Admin),
 * keeps maintenance to Airbnb properties and records the opening history
 * event. Only Airbnb properties are offered, as today.
 *
 * The draft survives closing the dialog; it is cleared after a successful
 * report. A failed report keeps every field and shows the server's reason.
 */
import * as React from "react";
import { MaintenanceAction, MaintenanceCategory, MaintenancePriority } from "@prisma/client";
import { EButton } from "@/components/v2/ui/primitives";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EField, EInput, ESelect, ESwitch, ETextarea } from "@/components/v2/admin/estate-kit";
import { ACTION_LABELS, CATEGORY_LABELS, PRIORITY_LABELS } from "@/lib/maintenance/labels";

export type ReportPropertyOption = { id: string; name: string; suburb: string | null };

type ReportDraft = {
  propertyId: string;
  title: string;
  area: string;
  description: string;
  category: MaintenanceCategory;
  recommendedAction: MaintenanceAction;
  priority: MaintenancePriority;
  estimatedCost: string;
  clientVisible: boolean;
};

const EMPTY: ReportDraft = {
  propertyId: "",
  title: "",
  area: "",
  description: "",
  category: MaintenanceCategory.OTHER,
  recommendedAction: MaintenanceAction.REPAIR,
  priority: MaintenancePriority.MEDIUM,
  estimatedCost: "",
  clientVisible: true,
};

const PHONE_INPUT = "max-sm:h-11 max-sm:text-base";

export function ReportItemDialog({
  open,
  properties,
  onClose,
  onCreated,
}: {
  open: boolean;
  properties: ReportPropertyOption[];
  onClose: () => void;
  onCreated: (itemId: string, title: string) => void;
}) {
  const [draft, setDraft] = React.useState<ReportDraft>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = (patch: Partial<ReportDraft>) => setDraft((current) => ({ ...current, ...patch }));

  async function submit() {
    if (!draft.propertyId || !draft.title.trim()) {
      setError("Choose the property and give the item a title.");
      return;
    }
    const estimate = draft.estimatedCost.trim() === "" ? null : Number(draft.estimatedCost);
    if (estimate !== null && (!Number.isFinite(estimate) || estimate < 0)) {
      setError("Enter the estimate in dollars, or leave it empty for not estimated.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: draft.propertyId,
          title: draft.title.trim(),
          area: draft.area.trim() || null,
          description: draft.description.trim() || null,
          category: draft.category,
          recommendedAction: draft.recommendedAction,
          priority: draft.priority,
          estimatedCost: estimate,
          clientVisible: draft.clientVisible,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { item?: { id: string; title: string }; error?: string };
      if (!response.ok || !body.item) throw new Error(body.error ?? "The item could not be reported. Your answers are kept.");
      setDraft(EMPTY);
      onCreated(body.item.id, body.item.title);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The item could not be reported. Your answers are kept.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EActionDialog
      open={open}
      busy={busy}
      onClose={onClose}
      title="Report an item"
      description="Something to repair or replace at an Airbnb property. It opens as Open with nobody assigned; high and urgent items alert the office as before."
      footer={
        <>
          <EButton variant="outline" onClick={onClose} disabled={busy}>Cancel</EButton>
          <EButton onClick={() => void submit()} disabled={busy}>{busy ? "Reporting…" : "Report item"}</EButton>
        </>
      }
    >
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        <EField label="Property">
          <ESelect value={draft.propertyId} onChange={(event) => set({ propertyId: event.target.value })} className={PHONE_INPUT}>
            <option value="">Choose an Airbnb property</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>{property.suburb ? `${property.name} · ${property.suburb}` : property.name}</option>
            ))}
          </ESelect>
        </EField>
        {properties.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No active Airbnb properties. Maintenance is for Airbnb properties only.</p> : null}
        <EField label="What needs doing">
          <EInput value={draft.title} maxLength={180} placeholder="e.g. Dishwasher not draining" onChange={(event) => set({ title: event.target.value })} className={PHONE_INPUT} />
        </EField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EField label="Area">
            <EInput value={draft.area} maxLength={120} placeholder="e.g. Kitchen" onChange={(event) => set({ area: event.target.value })} className={PHONE_INPUT} />
          </EField>
          <EField label="Estimate (AUD), internal" hint="Empty means not estimated.">
            <EInput type="number" min={0} step="0.01" inputMode="decimal" value={draft.estimatedCost} onChange={(event) => set({ estimatedCost: event.target.value })} className={PHONE_INPUT} />
          </EField>
          <EField label="Category">
            <ESelect value={draft.category} onChange={(event) => set({ category: event.target.value as MaintenanceCategory })} className={PHONE_INPUT}>
              {Object.values(MaintenanceCategory).map((value) => <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>)}
            </ESelect>
          </EField>
          <EField label="Action">
            <ESelect value={draft.recommendedAction} onChange={(event) => set({ recommendedAction: event.target.value as MaintenanceAction })} className={PHONE_INPUT}>
              {Object.values(MaintenanceAction).map((value) => <option key={value} value={value}>{ACTION_LABELS[value]}</option>)}
            </ESelect>
          </EField>
          <EField label="Priority">
            <ESelect value={draft.priority} onChange={(event) => set({ priority: event.target.value as MaintenancePriority })} className={PHONE_INPUT}>
              {Object.values(MaintenancePriority).map((value) => <option key={value} value={value}>{PRIORITY_LABELS[value]}</option>)}
            </ESelect>
          </EField>
        </div>
        <EField label="Details">
          <ETextarea value={draft.description} maxLength={6000} rows={3} onChange={(event) => set({ description: event.target.value })} className="max-sm:text-base" />
        </EField>
        <ESwitch checked={draft.clientVisible} onCheckedChange={(value) => set({ clientVisible: value })} label="The client sees this item" />
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Photos are added by the cleaner, inspector or client who reports from site; the office report has none.</p>
      </fieldset>
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
    </EActionDialog>
  );
}
