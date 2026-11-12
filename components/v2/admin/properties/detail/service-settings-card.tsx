"use client";

/**
 * "Service settings: saves on change". Each switch sends only its own field;
 * while one saves, every switch is frozen; a failed save leaves the switch as
 * the server has it and says why. Turning key lost mode on still asks first
 * (it reschedules upcoming laundry when saved).
 */
import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { ECard } from "@/components/v2/ui/primitives";
import { EConfirmModal, ESwitch } from "@/components/v2/admin/estate-kit";
import { CardHead, Muted } from "./section-card";
import type { PropertyRecord } from "./property-record";
import type { SaveResult } from "./use-property-record";

type ToggleKey = "hasBalcony" | "inventoryEnabled" | "laundryEnabled" | "keyLostMode" | "showCleanerContactToClient";

const TOGGLES: Array<{ key: ToggleKey; label: string; hint?: string }> = [
  { key: "hasBalcony", label: "Has balcony", hint: "balcony checklist fields" },
  { key: "inventoryEnabled", label: "Inventory tracked" },
  { key: "laundryEnabled", label: "Laundry service", hint: "off = left out of laundry scheduling" },
  { key: "keyLostMode", label: "Key lost mode", hint: "asks to confirm" },
  { key: "showCleanerContactToClient", label: "Show cleaner contact to client" },
];

function valueOf(property: PropertyRecord, key: ToggleKey): boolean {
  if (key === "laundryEnabled") return property.laundryEnabled !== false;
  return property[key] === true;
}

export function ServiceSettingsCard({ property, save }: { property: PropertyRecord; save: (patch: Record<string, unknown>) => Promise<SaveResult> }) {
  const [saving, setSaving] = useState<ToggleKey | null>(null);
  const [pendingValue, setPendingValue] = useState<boolean | null>(null);
  const [confirmKeyLost, setConfirmKeyLost] = useState(false);

  async function apply(key: ToggleKey, value: boolean) {
    setSaving(key);
    setPendingValue(value);
    const result = await save({ [key]: value });
    setSaving(null);
    setPendingValue(null);
    if (!result.ok) {
      toast({ title: "Save failed", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: `${TOGGLES.find((toggle) => toggle.key === key)?.label ?? "Setting"} ${value ? "on" : "off"}` });
  }

  return (
    <ECard className="flex w-full flex-col gap-1 p-4 lg:w-[300px] lg:flex-none">
      <CardHead title="Service settings" action={<Muted><span className="text-[0.75rem]">Saves on change</span></Muted>} />
      {TOGGLES.map((toggle) => {
        const checked = saving === toggle.key && pendingValue !== null ? pendingValue : valueOf(property, toggle.key);
        return (
          <div key={toggle.key} className="flex min-h-[44px] items-center justify-between gap-2 border-b border-[hsl(var(--e-border))] py-1 text-[0.8125rem] last:border-b-0">
            <span className="min-w-0">
              {toggle.label} {toggle.hint ? <Muted>{toggle.hint}</Muted> : null}
            </span>
            <ESwitch
              checked={checked}
              disabled={saving !== null}
              label={<span className="sr-only">{toggle.label}</span>}
              onCheckedChange={(value: boolean) => {
                if (toggle.key === "keyLostMode" && value && !property.keyLostMode) {
                  setConfirmKeyLost(true);
                  return;
                }
                void apply(toggle.key, value);
              }}
            />
          </div>
        );
      })}
      <EConfirmModal
        open={confirmKeyLost}
        onClose={() => setConfirmKeyLost(false)}
        title="Enable key lost mode"
        description="The laundry driver can't enter this property alone. While this is on, laundry pickup and drop-off are both scheduled on the cleaning day itself, after the clean starts — 12:30 when the job has a late checkout, otherwise 10:00. Saving reschedules upcoming laundry immediately."
        confirmLabel="Enable"
        onConfirm={() => {
          setConfirmKeyLost(false);
          void apply("keyLostMode", true);
        }}
      />
    </ECard>
  );
}
