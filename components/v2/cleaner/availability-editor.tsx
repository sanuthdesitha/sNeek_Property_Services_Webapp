"use client";

/**
 * Estate availability editor — weekly hours grid (per-day time ranges with an
 * available/unavailable toggle) plus date-specific overrides (time off).
 * Same endpoint + payload as the live cleaner availability workspace:
 *   GET  /api/cleaner/availability
 *   PATCH /api/cleaner/availability  { mode, weekly, dateOverrides, notes }
 */
import { useEffect, useMemo, useState } from "react";
import { CalendarX2, Plus, Trash2 } from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEyebrow,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ESwitch, ETextarea } from "@/components/v2/cleaner/fields";
import { toast } from "@/hooks/use-toast";

type AvailabilityMode = "FIXED" | "FLEXIBLE";

interface Slot {
  start: string;
  end: string;
}

interface AvailabilityState {
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

function SlotRow({
  slot,
  onChange,
  onRemove,
}: {
  slot: Slot;
  onChange: (next: Slot) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
      <EInput
        type="time"
        value={slot.start}
        onChange={(e) => onChange({ ...slot, start: e.target.value })}
        aria-label="Start time"
      />
      <EInput
        type="time"
        value={slot.end}
        onChange={(e) => onChange({ ...slot, end: e.target.value })}
        aria-label="End time"
      />
      <EButton type="button" variant="ghost" size="icon" onClick={onRemove} aria-label="Remove slot">
        <Trash2 className="h-4 w-4" />
      </EButton>
    </div>
  );
}

export function AvailabilityEditor() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<AvailabilityState>({
    mode: "FIXED",
    weekly: {},
    dateOverrides: {},
    notes: "",
  });
  const [newOverrideDate, setNewOverrideDate] = useState("");

  useEffect(() => {
    void (async () => {
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
        dateOverrides:
          body.dateOverrides && typeof body.dateOverrides === "object" ? body.dateOverrides : {},
        notes: body.notes ?? "",
        updatedAt: body.updatedAt,
      });
    })();
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
    setData((prev) => ({ ...prev, weekly: { ...prev.weekly, [dayKey]: slots } }));
  }

  function clearWeeklyDay(dayKey: string) {
    setData((prev) => {
      const nextWeekly = { ...prev.weekly };
      delete nextWeekly[dayKey];
      return { ...prev, weekly: nextWeekly };
    });
  }

  function addOverrideDate(asTimeOff: boolean) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newOverrideDate)) {
      toast({ title: "Select a valid date.", variant: "destructive" });
      return;
    }
    setData((prev) => ({
      ...prev,
      dateOverrides: {
        ...prev.dateOverrides,
        [newOverrideDate]:
          prev.dateOverrides[newOverrideDate] ?? (asTimeOff ? [] : [{ ...EMPTY_SLOT }]),
      },
    }));
    setNewOverrideDate("");
  }

  function updateOverride(dateKey: string, slots: Slot[]) {
    setData((prev) => ({
      ...prev,
      dateOverrides: { ...prev.dateOverrides, [dateKey]: slots },
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

  if (loading) {
    return (
      <ECard>
        <ECardBody className="pt-6 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Loading your availability…
        </ECardBody>
      </ECard>
    );
  }

  return (
    <div className="space-y-6">
      {/* Mode + notes */}
      <ECard>
        <ECardBody className="space-y-4 pt-6">
          <EEyebrow>SCHEDULE MODE</EEyebrow>
          <div className="grid gap-4 md:grid-cols-2">
            <EField label="Mode" hint="Fixed keeps the same week repeating; flexible means it varies.">
              <ESelect
                value={data.mode}
                onChange={(e) =>
                  setData((prev) => ({ ...prev, mode: e.target.value as AvailabilityMode }))
                }
              >
                <option value="FIXED">Fixed repeating schedule</option>
                <option value="FLEXIBLE">Flexible week-to-week</option>
              </ESelect>
            </EField>
            <EField label="Notes for the office">
              <ETextarea
                value={data.notes ?? ""}
                onChange={(e) => setData((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Optional — e.g. school pickup windows"
              />
            </EField>
          </div>
        </ECardBody>
      </ECard>

      {/* Weekly grid */}
      <section className="space-y-3">
        <span className="e-eyebrow">WEEKLY HOURS</span>
        <div className="grid gap-3 lg:grid-cols-2">
          {weeklyRows.map((row) => {
            const available = row.slots.length > 0;
            return (
              <ECard key={row.key}>
                <ECardBody className="space-y-3 pt-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <ESwitch
                        checked={available}
                        aria-label={`Available on ${row.label}`}
                        onCheckedChange={(on) =>
                          on ? updateWeeklyDay(row.key, [{ ...EMPTY_SLOT }]) : clearWeeklyDay(row.key)
                        }
                      />
                      <p className="text-[0.9375rem] font-[550]">{row.label}</p>
                    </div>
                    {available ? (
                      <EButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => updateWeeklyDay(row.key, [...row.slots, { ...EMPTY_SLOT }])}
                      >
                        <Plus className="h-3.5 w-3.5" /> Add range
                      </EButton>
                    ) : (
                      <EBadge tone="neutral" soft>
                        Unavailable
                      </EBadge>
                    )}
                  </div>
                  {available ? (
                    <div className="space-y-2">
                      {row.slots.map((slot, index) => (
                        <SlotRow
                          key={`${row.key}-${index}`}
                          slot={slot}
                          onChange={(next) => {
                            const slots = cloneSlots(row.slots);
                            slots[index] = next;
                            updateWeeklyDay(row.key, slots);
                          }}
                          onRemove={() =>
                            updateWeeklyDay(
                              row.key,
                              row.slots.filter((_, i) => i !== index)
                            )
                          }
                        />
                      ))}
                    </div>
                  ) : null}
                </ECardBody>
              </ECard>
            );
          })}
        </div>
      </section>

      {/* Date overrides / time off */}
      <section className="space-y-3">
        <span className="e-eyebrow">TIME OFF &amp; DATE CHANGES</span>
        <ECard>
          <ECardBody className="space-y-4 pt-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <EField label="Date" className="sm:w-56">
                <EInput
                  type="date"
                  value={newOverrideDate}
                  onChange={(e) => setNewOverrideDate(e.target.value)}
                />
              </EField>
              <div className="flex gap-2">
                <EButton type="button" variant="outline" onClick={() => addOverrideDate(true)}>
                  <CalendarX2 className="h-4 w-4" /> Request time off
                </EButton>
                <EButton type="button" variant="outline" onClick={() => addOverrideDate(false)}>
                  Different hours
                </EButton>
              </div>
            </div>

            {Object.keys(data.dateOverrides).length === 0 ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                No date-specific changes yet. Add a date above to request a day off or set one-off
                hours.
              </p>
            ) : (
              <div className="space-y-3">
                {Object.entries(data.dateOverrides)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([dateKey, slots]) => (
                    <div
                      key={dateKey}
                      className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-4"
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <p className="text-[0.875rem] font-[550] tabular-nums">{dateKey}</p>
                          {slots.length === 0 ? (
                            <EBadge tone="warning" soft>
                              Time off
                            </EBadge>
                          ) : (
                            <EBadge tone="info" soft>
                              Custom hours
                            </EBadge>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <EButton
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => updateOverride(dateKey, [...slots, { ...EMPTY_SLOT }])}
                          >
                            <Plus className="h-3.5 w-3.5" /> Add range
                          </EButton>
                          <EButton
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeOverride(dateKey)}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Remove date
                          </EButton>
                        </div>
                      </div>
                      {slots.length === 0 ? (
                        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          Marked unavailable for the whole day.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {slots.map((slot, index) => (
                            <SlotRow
                              key={`${dateKey}-${index}`}
                              slot={slot}
                              onChange={(next) => {
                                const nextSlots = cloneSlots(slots);
                                nextSlots[index] = next;
                                updateOverride(dateKey, nextSlots);
                              }}
                              onRemove={() =>
                                updateOverride(
                                  dateKey,
                                  slots.filter((_, i) => i !== index)
                                )
                              }
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </ECardBody>
        </ECard>
      </section>

      {/* Save bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          {data.updatedAt
            ? `Last updated ${new Date(data.updatedAt).toLocaleString("en-AU")}`
            : "Not saved yet."}
        </p>
        <EButton variant="gold" onClick={() => void save()} disabled={saving || loading}>
          {saving ? "Saving…" : "Save availability"}
        </EButton>
      </div>
    </div>
  );
}
