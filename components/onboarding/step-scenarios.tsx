"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface StepScenariosProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

const CADENCES = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "FORTNIGHTLY", label: "Fortnightly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "ON_DEMAND", label: "On demand" },
  { value: "CUSTOM", label: "Custom" },
];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Real-world STR scenarios captured as structured JSON (no schema columns).
 * Saved under scenarios / recurringSchedule / emergencyContact via form-meta.
 */
export function StepScenarios({ data, onChange }: StepScenariosProps) {
  const scenarios = (data.scenarios as Record<string, unknown>) ?? {};
  const schedule = (data.recurringSchedule as Record<string, unknown>) ?? {};
  const contact = (data.emergencyContact as Record<string, unknown>) ?? {};

  const setScenario = (key: string, value: unknown) =>
    onChange({ ...data, scenarios: { ...scenarios, [key]: value } });
  const setSchedule = (key: string, value: unknown) =>
    onChange({ ...data, recurringSchedule: { ...schedule, [key]: value } });
  const setContact = (key: string, value: unknown) =>
    onChange({ ...data, emergencyContact: { ...contact, [key]: value } });

  return (
    <div className="space-y-6">
      {/* Rooms / beds */}
      <section className="rounded-xl border p-4">
        <h3 className="mb-3 text-sm font-semibold">Rooms & beds</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Bed configuration</Label>
            <Input
              className="h-11"
              value={String(scenarios.bedConfig ?? "")}
              onChange={(e) => setScenario("bedConfig", e.target.value)}
              placeholder="e.g. 1x King, 2x Queen, 2x Single"
            />
          </div>
          <div>
            <Label>Total beds</Label>
            <Input
              type="number"
              min={0}
              className="h-11 tabular-nums"
              value={scenarios.bedCount != null ? String(scenarios.bedCount) : ""}
              onChange={(e) => setScenario("bedCount", e.target.value ? parseInt(e.target.value) : null)}
            />
          </div>
        </div>
      </section>

      {/* Check-in / out */}
      <section className="rounded-xl border p-4">
        <h3 className="mb-3 text-sm font-semibold">Check-in / check-out windows</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Default check-in time</Label>
            <Input
              type="time"
              className="h-11 tabular-nums"
              value={String(data.defaultCheckinTime ?? "14:00")}
              onChange={(e) => onChange({ ...data, defaultCheckinTime: e.target.value })}
            />
          </div>
          <div>
            <Label>Default check-out time</Label>
            <Input
              type="time"
              className="h-11 tabular-nums"
              value={String(data.defaultCheckoutTime ?? "10:00")}
              onChange={(e) => onChange({ ...data, defaultCheckoutTime: e.target.value })}
            />
          </div>
        </div>
      </section>

      {/* Pets / security / wifi */}
      <section className="rounded-xl border p-4">
        <h3 className="mb-3 text-sm font-semibold">Pets, security & connectivity</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex items-center gap-2">
            <Checkbox checked={scenarios.hasPets === true} onCheckedChange={(v) => setScenario("hasPets", v === true)} />
            <span className="text-sm">Property has pets</span>
          </label>
          <div className={scenarios.hasPets === true ? "" : "opacity-50"}>
            <Label>Pet details</Label>
            <Input
              className="h-11"
              disabled={scenarios.hasPets !== true}
              value={String(scenarios.petDetails ?? "")}
              onChange={(e) => setScenario("petDetails", e.target.value)}
              placeholder="e.g. 1 cat (indoor), allergy-safe products"
            />
          </div>
          <label className="flex items-center gap-2">
            <Checkbox checked={scenarios.hasAlarm === true} onCheckedChange={(v) => setScenario("hasAlarm", v === true)} />
            <span className="text-sm">Property has a security alarm</span>
          </label>
          <div className={scenarios.hasAlarm === true ? "" : "opacity-50"}>
            <Label>Alarm code / disarm steps</Label>
            <Input
              className="h-11 tabular-nums"
              disabled={scenarios.hasAlarm !== true}
              value={String(scenarios.alarmCode ?? "")}
              onChange={(e) => setScenario("alarmCode", e.target.value)}
              placeholder="Stored encrypted on the property"
            />
          </div>
          <div className={scenarios.hasAlarm === true ? "md:col-span-2" : "md:col-span-2 opacity-50"}>
            <Label>Alarm notes</Label>
            <Input
              className="h-11"
              disabled={scenarios.hasAlarm !== true}
              value={String(scenarios.alarmNotes ?? "")}
              onChange={(e) => setScenario("alarmNotes", e.target.value)}
              placeholder="e.g. 30s entry delay, panel by front door"
            />
          </div>
          <div>
            <Label>Wifi network</Label>
            <Input
              className="h-11"
              value={String(scenarios.wifiNetwork ?? "")}
              onChange={(e) => setScenario("wifiNetwork", e.target.value)}
            />
          </div>
          <div>
            <Label>Wifi password</Label>
            <Input
              className="h-11"
              value={String(scenarios.wifiPassword ?? "")}
              onChange={(e) => setScenario("wifiPassword", e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Bins / consumables / linen */}
      <section className="rounded-xl border p-4">
        <h3 className="mb-3 text-sm font-semibold">Bins, consumables & linen</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Bin / recycling day</Label>
            <Input
              className="h-11"
              value={String(scenarios.binDay ?? "")}
              onChange={(e) => setScenario("binDay", e.target.value)}
              placeholder="e.g. Tue general, alt-Wed recycling"
            />
          </div>
          <div>
            <Label>Bin notes</Label>
            <Input
              className="h-11"
              value={String(scenarios.binNotes ?? "")}
              onChange={(e) => setScenario("binNotes", e.target.value)}
              placeholder="Where bins live, who takes them out"
            />
          </div>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={scenarios.consumablesProvided === true}
              onCheckedChange={(v) => setScenario("consumablesProvided", v === true)}
            />
            <span className="text-sm">Consumables provided by us (restock)</span>
          </label>
          <div>
            <Label>Linen sets on site</Label>
            <Input
              type="number"
              min={0}
              className="h-11 tabular-nums"
              value={scenarios.linenSets != null ? String(scenarios.linenSets) : ""}
              onChange={(e) => setScenario("linenSets", e.target.value ? parseInt(e.target.value) : null)}
            />
          </div>
          <div>
            <Label>Linen buffer / par sets</Label>
            <Input
              type="number"
              min={0}
              className="h-11 tabular-nums"
              value={scenarios.linenBufferSets != null ? String(scenarios.linenBufferSets) : ""}
              onChange={(e) => setScenario("linenBufferSets", e.target.value ? parseInt(e.target.value) : null)}
            />
          </div>
          <div className="md:col-span-2">
            <Label>Consumables / restock expectations</Label>
            <Textarea
              value={String(scenarios.restockExpectations ?? "")}
              onChange={(e) => setScenario("restockExpectations", e.target.value)}
              placeholder="Toilet paper, soap, coffee pods, welcome amenities, who restocks…"
            />
          </div>
        </div>
      </section>

      {/* No-go areas */}
      <section className="rounded-xl border p-4">
        <h3 className="mb-3 text-sm font-semibold">No-go areas & boundaries</h3>
        <Textarea
          value={String(scenarios.noGoAreas ?? "")}
          onChange={(e) => setScenario("noGoAreas", e.target.value)}
          placeholder="Locked owner's closet, garage off-limits, do not touch personal items in master, etc."
        />
      </section>

      {/* Recurring schedule */}
      <section className="rounded-xl border p-4">
        <h3 className="mb-3 text-sm font-semibold">Recurring schedule</h3>
        <label className="mb-3 flex items-center gap-2">
          <Checkbox checked={schedule.enabled === true} onCheckedChange={(v) => setSchedule("enabled", v === true)} />
          <span className="text-sm">This property has a recurring clean</span>
        </label>
        {schedule.enabled === true && (
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Cadence</Label>
              <Select value={String(schedule.cadence ?? "")} onValueChange={(v) => setSchedule("cadence", v)}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {CADENCES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Preferred day</Label>
              <Select
                value={schedule.dayOfWeek != null ? String(schedule.dayOfWeek) : ""}
                onValueChange={(v) => setSchedule("dayOfWeek", parseInt(v))}
              >
                <SelectTrigger className="h-11"><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  {DAYS.map((d, i) => <SelectItem key={d} value={String(i)}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Preferred time</Label>
              <Input
                type="time"
                className="h-11 tabular-nums"
                value={String(schedule.preferredTime ?? "")}
                onChange={(e) => setSchedule("preferredTime", e.target.value)}
              />
            </div>
          </div>
        )}
      </section>

      {/* Emergency / owner contact */}
      <section className="rounded-xl border p-4">
        <h3 className="mb-3 text-sm font-semibold">Emergency / owner contact</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Contact name</Label>
            <Input className="h-11" value={String(contact.name ?? "")} onChange={(e) => setContact("name", e.target.value)} />
          </div>
          <div>
            <Label>Phone</Label>
            <Input className="h-11" value={String(contact.phone ?? "")} onChange={(e) => setContact("phone", e.target.value)} placeholder="04XX XXX XXX" />
          </div>
          <div>
            <Label>Relationship</Label>
            <Input className="h-11" value={String(contact.relation ?? "")} onChange={(e) => setContact("relation", e.target.value)} placeholder="Owner, property manager…" />
          </div>
          <div>
            <Label>Email</Label>
            <Input className="h-11" type="email" value={String(contact.email ?? "")} onChange={(e) => setContact("email", e.target.value)} />
          </div>
        </div>
      </section>
    </div>
  );
}
