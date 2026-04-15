"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

interface EstimationResult {
  estimatedHours: number;
  suggestedCleanerCount: number;
  estimatedPrice: number;
  priceBreakdown: { label: string; amount: number }[];
  confidence: string;
  warnings: string[];
}

interface StepStaffingProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

export function StepStaffing({ data, onChange }: StepStaffingProps) {
  const [estimation, setEstimation] = useState<EstimationResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchEstimation();
    }, 500);
    return () => clearTimeout(timer);
  }, [data.bedrooms, data.bathrooms, data.hasBalcony, data.floorCount, data.propertyType, data.sizeSqm, data.selectedJobTypes]);

  async function fetchEstimation() {
    const appliances = (data.appliances as any[]) ?? [];
    const specialRequests = (data.specialRequests as any[]) ?? [];

    setLoading(true);
    try {
      const res = await fetch("/api/admin/onboarding/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bedrooms: Number(data.bedrooms ?? 1),
          bathrooms: Number(data.bathrooms ?? 1),
          hasBalcony: data.hasBalcony === true,
          floorCount: Number(data.floorCount ?? 1),
          propertyType: data.propertyType ?? null,
          sizeSqm: data.sizeSqm ? Number(data.sizeSqm) : null,
          applianceCount: appliances.length,
          specialRequestCount: specialRequests.length,
          conditionLevel: data.conditionLevel ?? "standard",
          selectedJobTypes: data.selectedJobTypes ?? [],
          laundryEnabled: (data.laundryDetail as any)?.hasLaundry === true,
        }),
      });
      const result = await res.json();
      if (result.estimatedHours) {
        setEstimation(result);
        onChange({
          ...data,
          estimatedHours: result.estimatedHours,
          estimatedCleanerCount: result.suggestedCleanerCount,
          estimatedPrice: result.estimatedPrice,
        });
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Requested cleaner count</Label>
          <Input
            type="number"
            min={1}
            max={20}
            value={Number(data.requestedCleanerCount ?? 1)}
            onChange={(e) => onChange({ ...data, requestedCleanerCount: parseInt(e.target.value) || 1 })}
          />
        </div>
        {estimation && (
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-sm font-medium">Auto-estimated</p>
            <div className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Hours</span>
                <span className="font-medium">{estimation.estimatedHours}h</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cleaners</span>
                <span className="font-medium">{estimation.suggestedCleanerCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. price</span>
                <span className="font-medium">${estimation.estimatedPrice.toFixed(2)}</span>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={estimation.confidence === "high" ? "success" : "warning"}>
                {estimation.confidence} confidence
              </Badge>
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
          </div>
        )}
      </div>

      {estimation?.priceBreakdown && estimation.priceBreakdown.length > 0 && (
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium mb-2">Price breakdown</p>
          {estimation.priceBreakdown.map((item, i) => (
            <div key={i} className="flex justify-between text-sm py-1">
              <span className="text-muted-foreground">{item.label}</span>
              <span>${item.amount.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {estimation?.warnings && estimation.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50/50 p-3 text-sm text-amber-800">
          {estimation.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}
    </div>
  );
}
