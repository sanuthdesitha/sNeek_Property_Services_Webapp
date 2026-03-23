"use client";

import { useEffect, useMemo, useState } from "react";
import { JobType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";

type RateDraft = {
  hasRecord: boolean;
  baseCharge: string;
  billingUnit: string;
  defaultDescription: string;
  isActive: boolean;
};

function moneyLabel(value: string) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : "$0.00";
}

export function PropertyClientRateEditor({ propertyId }: { propertyId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, RateDraft>>({});

  const jobTypes = useMemo(() => Object.values(JobType), []);

  async function loadRates() {
    setLoading(true);
    const res = await fetch(`/api/admin/property-client-rates?propertyId=${propertyId}`, { cache: "no-store" });
    const body = await res.json().catch(() => []);
    setLoading(false);
    if (!res.ok) {
      toast({ title: "Could not load client rates", description: body.error ?? "Please refresh and try again.", variant: "destructive" });
      return;
    }

    const rows = Array.isArray(body) ? body : [];
    const byJobType = new Map(rows.map((row: any) => [row.jobType, row]));
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
  }

  useEffect(() => {
    void loadRates();
  }, [propertyId]);

  async function saveRates() {
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
            if (!res.ok) {
              throw new Error(body.error ?? `Could not save ${jobType.replace(/_/g, " ").toLowerCase()} rate.`);
            }
            return body;
          })
        );

      await Promise.all(payloads);
      toast({ title: "Client pricing updated" });
      await loadRates();
    } catch (error: any) {
      toast({
        title: "Rate save failed",
        description: error?.message ?? "Could not save property client pricing.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Client Pricing</CardTitle>
          <CardDescription>
            Set the per-job charges used for client invoicing and client finance visibility at this property.
          </CardDescription>
        </div>
        <Button onClick={saveRates} disabled={saving || loading}>
          {saving ? "Saving..." : "Save pricing"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading property pricing...</p>
        ) : (
          jobTypes.map((jobType) => {
            const draft = drafts[jobType] ?? {
              hasRecord: false,
              baseCharge: "",
              billingUnit: "PER_JOB",
              defaultDescription: "",
              isActive: false,
            };
            return (
              <div key={jobType} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{jobType.replace(/_/g, " ")}</p>
                    <p className="text-xs text-muted-foreground">
                      {draft.isActive ? `Active at ${moneyLabel(draft.baseCharge)}` : "Hidden from invoices/client finance until enabled"}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <span>Active</span>
                    <Switch
                      checked={draft.isActive}
                      onCheckedChange={(value) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [jobType]: { ...prev[jobType], isActive: value, hasRecord: true },
                        }))
                      }
                    />
                  </label>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-[180px_160px_minmax(0,1fr)]">
                  <div className="space-y-1.5">
                    <Label>Charge</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.baseCharge}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [jobType]: { ...prev[jobType], baseCharge: e.target.value, hasRecord: true },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Billing unit</Label>
                    <Input
                      value={draft.billingUnit}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [jobType]: { ...prev[jobType], billingUnit: e.target.value || "PER_JOB", hasRecord: true },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Description</Label>
                    <Input
                      value={draft.defaultDescription}
                      placeholder="Optional invoice description"
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [jobType]: { ...prev[jobType], defaultDescription: e.target.value, hasRecord: true },
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
