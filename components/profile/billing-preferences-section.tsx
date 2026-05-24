"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

type Cadence = "ON_COMPLETION" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "CUSTOM";

interface BillingPreferencesSectionProps {
  initialCadence?: Cadence;
  initialDayOfWeek?: number | null;
  initialDayOfMonth?: number | null;
}

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function BillingPreferencesSection({
  initialCadence = "ON_COMPLETION",
  initialDayOfWeek = null,
  initialDayOfMonth = null,
}: BillingPreferencesSectionProps) {
  const [cadence, setCadence] = React.useState<Cadence>(initialCadence);
  const [dayOfWeek, setDayOfWeek] = React.useState<number | null>(initialDayOfWeek);
  const [dayOfMonth, setDayOfMonth] = React.useState<number | null>(initialDayOfMonth);
  const [saving, setSaving] = React.useState(false);
  const router = useRouter();

  async function save(payload: {
    invoicingCadence?: Cadence;
    invoiceDayOfWeek?: number | null;
    invoiceDayOfMonth?: number | null;
  }) {
    setSaving(true);
    try {
      await fetch("/api/me/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing Preferences</CardTitle>
        <CardDescription>How and when you want invoices issued.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="cadence">Cadence</Label>
          <Select
            value={cadence}
            onValueChange={(v: Cadence) => {
              setCadence(v);
              save({ invoicingCadence: v });
            }}
            disabled={saving}
          >
            <SelectTrigger id="cadence">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ON_COMPLETION">On job completion (default)</SelectItem>
              <SelectItem value="WEEKLY">Weekly</SelectItem>
              <SelectItem value="FORTNIGHTLY">Fortnightly</SelectItem>
              <SelectItem value="MONTHLY">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {(cadence === "WEEKLY" || cadence === "FORTNIGHTLY") && (
          <div className="space-y-1">
            <Label htmlFor="dow">Day of week</Label>
            <Select
              value={(dayOfWeek ?? 1).toString()}
              onValueChange={(v) => {
                const n = parseInt(v, 10);
                setDayOfWeek(n);
                save({ invoiceDayOfWeek: n });
              }}
              disabled={saving}
            >
              <SelectTrigger id="dow">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS_OF_WEEK.map((d, i) => (
                  <SelectItem key={d} value={i.toString()}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {cadence === "MONTHLY" && (
          <div className="space-y-1">
            <Label htmlFor="dom">Day of month</Label>
            <Select
              value={(dayOfMonth ?? 1).toString()}
              onValueChange={(v) => {
                const n = parseInt(v, 10);
                setDayOfMonth(n);
                save({ invoiceDayOfMonth: n });
              }}
              disabled={saving}
            >
              <SelectTrigger id="dom">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={n.toString()}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
