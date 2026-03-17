"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

type AvailabilityMode = "FIXED" | "FLEXIBLE";

interface Slot {
  start: string;
  end: string;
}

interface AvailabilityPayload {
  mode: AvailabilityMode;
  weekly: Record<string, Slot[]>;
  dateOverrides: Record<string, Slot[]>;
  notes: string | null;
  updatedAt?: string;
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const EMPTY_SLOT: Slot = { start: "09:00", end: "17:00" };

function cloneSlots(slots: Slot[]) {
  return slots.map((slot) => ({ ...slot }));
}

export function CleanerAvailabilityPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<AvailabilityPayload>({
    mode: "FIXED",
    weekly: {},
    dateOverrides: {},
    notes: "",
  });
  const [newOverrideDate, setNewOverrideDate] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/cleaner/availability", { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      toast({
        title: "Could not load availability",
        description: body.error ?? "Please retry.",
        variant: "destructive",
      });
      return;
    }
    setData({
      mode: body.mode === "FLEXIBLE" ? "FLEXIBLE" : "FIXED",
      weekly: body.weekly && typeof body.weekly === "object" ? body.weekly : {},
      dateOverrides: body.dateOverrides && typeof body.dateOverrides === "object" ? body.dateOverrides : {},
      notes: body.notes ?? "",
      updatedAt: body.updatedAt,
    });
  }

  useEffect(() => {
    load();
  }, []);

  const weeklyRows = useMemo(
    () =>
      DAY_LABELS.map((label, index) => ({
        key: String(index),
        label,
        slots: cloneSlots(data.weekly[String(index)] ?? []),
      })),
    [data.weekly]
  );

  function updateWeeklyDay(dayKey: string, slots: Slot[]) {
    setData((prev) => ({
      ...prev,
      weekly: {
        ...prev.weekly,
        [dayKey]: slots,
      },
    }));
  }

  function removeWeeklyDay(dayKey: string) {
    setData((prev) => {
      const nextWeekly = { ...prev.weekly };
      delete nextWeekly[dayKey];
      return { ...prev, weekly: nextWeekly };
    });
  }

  function addOverrideDate() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newOverrideDate)) {
      toast({ title: "Select a valid date.", variant: "destructive" });
      return;
    }
    setData((prev) => ({
      ...prev,
      dateOverrides: {
        ...prev.dateOverrides,
        [newOverrideDate]: prev.dateOverrides[newOverrideDate] ?? [EMPTY_SLOT],
      },
    }));
    setNewOverrideDate("");
  }

  function updateOverride(dateKey: string, slots: Slot[]) {
    setData((prev) => ({
      ...prev,
      dateOverrides: {
        ...prev.dateOverrides,
        [dateKey]: slots,
      },
    }));
  }

  function removeOverride(dateKey: string) {
    setData((prev) => {
      const next = { ...prev.dateOverrides };
      delete next[dateKey];
      return { ...prev, dateOverrides: next };
    });
  }

  async function save() {
    setSaving(true);
    const res = await fetch("/api/cleaner/availability", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: data.mode,
        weekly: data.weekly,
        dateOverrides: data.dateOverrides,
        notes: data.notes || null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast({
        title: "Could not save availability",
        description: body.error ?? "Please check your inputs.",
        variant: "destructive",
      });
      return;
    }
    setData((prev) => ({ ...prev, updatedAt: body.updatedAt }));
    toast({ title: "Availability updated" });
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Availability</h1>
        <p className="text-sm text-muted-foreground">
          Set your repeating weekly pattern and day-specific changes.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Availability Mode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Select
                value={data.mode}
                onValueChange={(value: AvailabilityMode) => setData((prev) => ({ ...prev, mode: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FIXED">Fixed repeating schedule</SelectItem>
                  <SelectItem value="FLEXIBLE">Flexible week-to-week</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                value={data.notes ?? ""}
                onChange={(e) => setData((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Optional notes for admin (e.g. school pickup windows)"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Weekly Pattern</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
          {weeklyRows.map((row) => (
            <div key={row.key} className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">{row.label}</p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => updateWeeklyDay(row.key, [...row.slots, { ...EMPTY_SLOT }])}
                  >
                    Add slot
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeWeeklyDay(row.key)}>
                    Clear
                  </Button>
                </div>
              </div>
              {row.slots.length === 0 ? (
                <p className="text-xs text-muted-foreground">Unavailable</p>
              ) : (
                <div className="space-y-2">
                  {row.slots.map((slot, index) => (
                    <div key={`${row.key}-${index}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                      <Input
                        type="time"
                        value={slot.start}
                        onChange={(e) => {
                          const next = cloneSlots(row.slots);
                          next[index] = { ...next[index], start: e.target.value };
                          updateWeeklyDay(row.key, next);
                        }}
                      />
                      <Input
                        type="time"
                        value={slot.end}
                        onChange={(e) => {
                          const next = cloneSlots(row.slots);
                          next[index] = { ...next[index], end: e.target.value };
                          updateWeeklyDay(row.key, next);
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => updateWeeklyDay(row.key, row.slots.filter((_, i) => i !== index))}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Date Overrides</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[200px_auto]">
            <Input type="date" value={newOverrideDate} onChange={(e) => setNewOverrideDate(e.target.value)} />
            <Button type="button" variant="outline" onClick={addOverrideDate}>
              Add date override
            </Button>
          </div>
          {Object.keys(data.dateOverrides).length === 0 ? (
            <p className="text-xs text-muted-foreground">No date-specific changes yet.</p>
          ) : (
            Object.entries(data.dateOverrides)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([dateKey, slots]) => (
                <div key={dateKey} className="rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium">{dateKey}</p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => updateOverride(dateKey, [...slots, { ...EMPTY_SLOT }])}
                      >
                        Add slot
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => removeOverride(dateKey)}>
                        Remove date
                      </Button>
                    </div>
                  </div>
                  {slots.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Unavailable on this date</p>
                  ) : (
                    <div className="space-y-2">
                      {slots.map((slot, index) => (
                        <div key={`${dateKey}-${index}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                          <Input
                            type="time"
                            value={slot.start}
                            onChange={(e) => {
                              const next = cloneSlots(slots);
                              next[index] = { ...next[index], start: e.target.value };
                              updateOverride(dateKey, next);
                            }}
                          />
                          <Input
                            type="time"
                            value={slot.end}
                            onChange={(e) => {
                              const next = cloneSlots(slots);
                              next[index] = { ...next[index], end: e.target.value };
                              updateOverride(dateKey, next);
                            }}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => updateOverride(dateKey, slots.filter((_, i) => i !== index))}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {data.updatedAt ? `Last updated: ${new Date(data.updatedAt).toLocaleString("en-AU")}` : "Not saved yet."}
        </p>
        <Button onClick={save} disabled={saving || loading}>
          {saving ? "Saving..." : "Save availability"}
        </Button>
      </div>
    </div>
  );
}
