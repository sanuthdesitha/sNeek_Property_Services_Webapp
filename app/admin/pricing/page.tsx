"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/hooks/use-toast";

type Band = { label: string; price: number };
type Rate = {
  base?: number;
  perBedroom?: number;
  perBathroom?: number;
  perSqm?: number;
  perWindow?: number;
  perItem?: number;
  hourly?: number;
  bands?: Band[];
  minCharge: number;
};
type Service = {
  jobType: string;
  label: string;
  model: "ROOMS" | "AREA" | "WINDOWS" | "ITEMS" | "BANDS" | "HOURLY";
  itemLabel: string | null;
  unitLabel: string | null;
  rate: Rate;
};

const MODEL_LABEL: Record<Service["model"], string> = {
  ROOMS: "Per bedroom + bathroom",
  AREA: "Per area",
  WINDOWS: "Per window",
  ITEMS: "Per item",
  BANDS: "Size bands",
  HOURLY: "Hourly",
};

function NumField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (n: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">$</span>
        <Input type="number" className="h-9" value={value ?? 0} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
    </div>
  );
}

export default function PricingPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [gstEnabled, setGstEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState<string | null>(null);
  const [savingGst, setSavingGst] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/pricing/services", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not load pricing", description: body.error ?? "Retry.", variant: "destructive" });
        return;
      }
      setServices(body.services ?? []);
      setGstEnabled(Boolean(body.gstEnabled));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function patchRate(jobType: string, patch: Partial<Rate>) {
    setServices((prev) => prev.map((s) => (s.jobType === jobType ? { ...s, rate: { ...s.rate, ...patch } } : s)));
  }
  function patchBand(jobType: string, idx: number, patch: Partial<Band>) {
    setServices((prev) =>
      prev.map((s) => {
        if (s.jobType !== jobType) return s;
        const bands = (s.rate.bands ?? []).map((b, i) => (i === idx ? { ...b, ...patch } : b));
        return { ...s, rate: { ...s.rate, bands } };
      })
    );
  }

  async function saveService(s: Service) {
    setSavingType(s.jobType);
    try {
      const res = await fetch("/api/admin/pricing/services", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobType: s.jobType, rate: s.rate }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Save failed.");
      }
      toast({ title: `${s.label} saved` });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingType(null);
    }
  }

  async function saveGst(next: boolean) {
    setGstEnabled(next);
    setSavingGst(true);
    try {
      await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pricing: { gstEnabled: next } }),
      });
      toast({ title: "GST setting saved" });
    } finally {
      setSavingGst(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading pricing…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<DollarSign />}
        title="Service pricing"
        description="Each service is priced by the fields that matter for it. Rates are ex-GST and feed every quote. Edit and save per service."
      />

      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-medium">Add GST (10%) to quotes</p>
            <p className="text-xs text-muted-foreground">Rates below are ex-GST; GST is added on top when enabled.</p>
          </div>
          <Switch checked={gstEnabled} disabled={savingGst} onCheckedChange={saveGst} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {services.map((s) => (
          <Card key={s.jobType}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">{s.label}</CardTitle>
                <Badge variant="outline" className="mt-1">{MODEL_LABEL[s.model]}</Badge>
              </div>
              <Button size="sm" onClick={() => saveService(s)} disabled={savingType === s.jobType}>
                <Save className="mr-1.5 h-4 w-4" />
                {savingType === s.jobType ? "Saving…" : "Save"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {s.model === "ROOMS" ? (
                  <>
                    <NumField label="Base" value={s.rate.base} onChange={(n) => patchRate(s.jobType, { base: n })} />
                    <NumField label="Per bedroom" value={s.rate.perBedroom} onChange={(n) => patchRate(s.jobType, { perBedroom: n })} />
                    <NumField label="Per bathroom" value={s.rate.perBathroom} onChange={(n) => patchRate(s.jobType, { perBathroom: n })} />
                    <NumField label="Per sqm" value={s.rate.perSqm} onChange={(n) => patchRate(s.jobType, { perSqm: n })} />
                  </>
                ) : null}
                {s.model === "AREA" ? (
                  <>
                    <NumField label="Base" value={s.rate.base} onChange={(n) => patchRate(s.jobType, { base: n })} />
                    <NumField label={`Per ${s.unitLabel ?? "sqm"}`} value={s.rate.perSqm} onChange={(n) => patchRate(s.jobType, { perSqm: n })} />
                  </>
                ) : null}
                {s.model === "WINDOWS" ? (
                  <>
                    <NumField label="Base" value={s.rate.base} onChange={(n) => patchRate(s.jobType, { base: n })} />
                    <NumField label="Per window" value={s.rate.perWindow} onChange={(n) => patchRate(s.jobType, { perWindow: n })} />
                  </>
                ) : null}
                {s.model === "ITEMS" ? (
                  <>
                    <NumField label="Base" value={s.rate.base} onChange={(n) => patchRate(s.jobType, { base: n })} />
                    <NumField label={`Per ${s.itemLabel ?? "item"}`} value={s.rate.perItem} onChange={(n) => patchRate(s.jobType, { perItem: n })} />
                  </>
                ) : null}
                {s.model === "HOURLY" ? (
                  <>
                    <NumField label="Base" value={s.rate.base} onChange={(n) => patchRate(s.jobType, { base: n })} />
                    <NumField label="Per hour" value={s.rate.hourly} onChange={(n) => patchRate(s.jobType, { hourly: n })} />
                  </>
                ) : null}
                <NumField label="Minimum charge" value={s.rate.minCharge} onChange={(n) => patchRate(s.jobType, { minCharge: n })} />
              </div>

              {s.model === "BANDS" ? (
                <div className="space-y-2">
                  {(s.rate.bands ?? []).map((b, i) => (
                    <div key={i} className="grid grid-cols-3 items-center gap-2">
                      <Input className="col-span-2 h-9" value={b.label} onChange={(e) => patchBand(s.jobType, i, { label: e.target.value })} />
                      <div className="flex items-center gap-1"><span className="text-muted-foreground">$</span><Input className="h-9" type="number" value={b.price} onChange={(e) => patchBand(s.jobType, i, { price: Number(e.target.value) })} /></div>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
