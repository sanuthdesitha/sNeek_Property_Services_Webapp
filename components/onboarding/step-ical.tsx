"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface StepIcalProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

export function StepIcal({ data, onChange }: StepIcalProps) {
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; eventCount?: number; provider?: string; error?: string } | null>(null);

  async function validateUrl() {
    const url = String(data.icalUrl ?? "");
    if (!url) return;

    setValidating(true);
    try {
      const res = await fetch("/api/admin/onboarding/ical/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icalUrl: url }),
      });
      const result = await res.json();
      setValidationResult(result);
      if (result.valid) {
        onChange({ ...data, icalProvider: result.provider });
        toast({ title: "iCal feed validated", description: `${result.eventCount} events found.` });
      } else {
        toast({ title: "iCal validation failed", description: result.error, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Validation failed", description: err.message, variant: "destructive" });
    } finally {
      setValidating(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Optionally provide an iCal URL to auto-sync reservations. This step can be skipped and configured later.
      </p>

      <div>
        <Label>iCal feed URL</Label>
        <div className="flex gap-2">
          <Input
            value={String(data.icalUrl ?? "")}
            onChange={(e) => {
              onChange({ ...data, icalUrl: e.target.value });
              setValidationResult(null);
            }}
            placeholder="https://example.com/calendar.ics"
          />
          <Button variant="outline" onClick={validateUrl} disabled={!data.icalUrl || validating}>
            {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validate"}
          </Button>
        </div>
      </div>

      {validationResult && (
        <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${validationResult.valid ? "border-green-300 bg-green-50/50" : "border-red-300 bg-red-50/50"}`}>
          {validationResult.valid ? (
            <CheckCircle className="h-4 w-4 text-green-600" />
          ) : (
            <XCircle className="h-4 w-4 text-red-600" />
          )}
          <span>{validationResult.valid ? `Valid feed — ${validationResult.eventCount} events found.` : validationResult.error}</span>
          {validationResult.provider && (
            <Badge variant="outline">{validationResult.provider.replace("ICAL_", "").replace("_", " ")}</Badge>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Tip: You can skip this step and add the iCal link later in the property settings.
      </p>
    </div>
  );
}
