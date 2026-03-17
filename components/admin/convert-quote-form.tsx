"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";

interface PropertyOption {
  id: string;
  name: string;
  suburb: string;
}

interface ConvertQuoteFormProps {
  quoteId: string;
  serviceType: string;
  properties: PropertyOption[];
}

export function ConvertQuoteForm({ quoteId, serviceType, properties }: ConvertQuoteFormProps) {
  const router = useRouter();
  const [propertyId, setPropertyId] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [saving, setSaving] = useState(false);

  async function convert() {
    if (!propertyId || !scheduledDate) {
      toast({ title: "Property and date are required.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        propertyId,
        scheduledDate: `${scheduledDate}T00:00:00.000Z`,
      };

      const res = await fetch(`/api/admin/quotes/${quoteId}/convert-to-job`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to convert quote.");
      }

      toast({ title: "Quote converted to job" });
      router.push(`/admin/jobs/${body.job.id}`);
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Convert failed",
        description: err.message ?? "Failed to convert quote.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Convert Quote to Job</h2>
          <p className="text-sm text-muted-foreground">Service: {serviceType.replace(/_/g, " ")}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/quotes">Back</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Job Setup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Property</Label>
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger>
                <SelectValue placeholder="Select property" />
              </SelectTrigger>
              <SelectContent>
                {properties.map((property) => (
                  <SelectItem key={property.id} value={property.id}>
                    {property.name} ({property.suburb})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="scheduledDate">Scheduled Date</Label>
            <Input
              id="scheduledDate"
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
            />
          </div>

          <div className="flex justify-end">
            <Button onClick={convert} disabled={saving}>
              {saving ? "Converting..." : "Convert to job"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
