"use client";

/**
 * ESTATE property billing rates — v2-native rebuild of the v1
 * PropertyClientRateEditor. Same API surface:
 *   load → GET /api/admin/property-client-rates?propertyId=…
 *   save → PUT /api/admin/property-client-rates
 *            { propertyId, jobType, baseCharge, billingUnit, defaultDescription?, isActive }
 * One row per job type; active rows with a charge feed the client invoice engine.
 */
import { useEffect, useMemo, useState } from "react";
import { JobType } from "@prisma/client";
import { Save } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { EField, EInput, ESwitch } from "@/components/v2/admin/estate-kit";

type RateDraft = {
  hasRecord: boolean;
  baseCharge: string;
  billingUnit: string;
  defaultDescription: string;
  isActive: boolean;
};

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function PropertyBillingRates({ propertyId }: { propertyId: string }) {
  const jobTypes = useMemo(() => Object.values(JobType), []);
  const [drafts, setDrafts] = useState<Record<string, RateDraft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadRates() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/property-client-rates?propertyId=${propertyId}`, { cache: "no-store" });
      const body = await res.json().catch(() => []);
      if (!res.ok) {
        toast({ title: "Could not load client rates", description: body.error ?? "Please refresh and try again.", variant: "destructive" });
        return;
      }
      const rows = Array.isArray(body) ? body : [];
      const byJobType = new Map<string, any>(rows.map((row: any) => [row.jobType, row]));
      const next: Record<string, RateDraft> = {};
      for (const jobType of jobTypes) {
        const row = byJobType.get(jobType);
        next[jobType] = {
          hasRecord: Boolean(row),
          baseCharge: row?.baseCharge != null ? String(row.baseCharge) : "",
          billingUnit: typeof row?.billingUnit === "string" && row.billingUnit.trim() ? row.billingUnit : "PER_JOB",
          defaultDescription: row?.defaultDescription ?? "",
          isActive: row?.isActive === true,
        };
      }
      setDrafts(next);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  function setDraft(jobType: string, patch: Partial<RateDraft>) {
    setDrafts((prev) => ({
      ...prev,
      [jobType]: { ...prev[jobType], ...patch, hasRecord: true },
    }));
  }

  async function saveAll() {
    setSaving(true);
    try {
      const payloads = Object.entries(drafts)
        .filter(([, row]) => row.hasRecord || row.baseCharge.trim() || row.defaultDescription.trim() || row.isActive)
        .map(([jobType, row]) =>
          fetch("/api/admin/property-client-rates", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              propertyId,
              jobType,
              baseCharge: Number(row.baseCharge || 0),
              billingUnit: row.billingUnit || "PER_JOB",
              defaultDescription: row.defaultDescription || undefined,
              isActive: row.isActive && Number(row.baseCharge || 0) > 0,
            }),
          }).then(async (res) => {
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error ?? `Could not save ${titleCase(jobType).toLowerCase()} rate.`);
            return body;
          })
        );
      await Promise.all(payloads);
      toast({ title: "Client rates saved" });
      await loadRates();
    } catch (err: any) {
      toast({ title: "Save failed", description: err?.message ?? "Could not save client rates.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ECard>
      <ECardHeader className="flex-row items-center justify-between pb-2">
        <ECardTitle className="text-[0.95rem]">Client billing rates</ECardTitle>
        <EButton variant="gold" size="sm" onClick={saveAll} disabled={saving || loading}>
          <Save className="mr-1 h-3.5 w-3.5" /> {saving ? "Saving…" : "Save rates"}
        </EButton>
      </ECardHeader>
      <ECardBody className="space-y-2.5 pt-0">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Per-job-type charges for this property. Active rows with a charge above zero are used when generating client invoices.
        </p>
        {loading ? (
          <p className="py-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading rates…</p>
        ) : (
          jobTypes.map((jobType) => {
            const draft = drafts[jobType];
            if (!draft) return null;
            return (
              <div
                key={jobType}
                className="grid items-end gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 sm:grid-cols-[1.2fr_0.8fr_0.8fr_1.2fr_auto]"
              >
                <p className="self-center text-[0.875rem] font-[550]">{titleCase(jobType)}</p>
                <EField label="Charge (AUD)">
                  <EInput
                    type="number"
                    min="0"
                    step="0.01"
                    className="h-9"
                    value={draft.baseCharge}
                    onChange={(e) => setDraft(jobType, { baseCharge: e.target.value })}
                  />
                </EField>
                <EField label="Billing unit">
                  <EInput
                    className="h-9"
                    value={draft.billingUnit}
                    onChange={(e) => setDraft(jobType, { billingUnit: e.target.value || "PER_JOB" })}
                  />
                </EField>
                <EField label="Invoice description">
                  <EInput
                    className="h-9"
                    placeholder="Optional"
                    value={draft.defaultDescription}
                    onChange={(e) => setDraft(jobType, { defaultDescription: e.target.value })}
                  />
                </EField>
                <div className="flex items-center gap-2 pb-1">
                  <ESwitch checked={draft.isActive} onCheckedChange={(v) => setDraft(jobType, { isActive: v })} />
                  <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Active</span>
                </div>
              </div>
            );
          })
        )}
      </ECardBody>
    </ECard>
  );
}
