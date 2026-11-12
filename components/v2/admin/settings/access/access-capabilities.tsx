"use client";

import { capabilitySource, effectiveCapabilities } from "@/lib/rbac/access-evaluator";
import { capabilitiesForArea, type CapabilityKey } from "@/lib/rbac/capabilities";
import type { OpsFeature } from "@/lib/rbac/ops-catalog";
import { resolveAccessLevels, type OpsPolicy } from "@/lib/rbac/ops-policy";
import { SensitiveBadge } from "./access-badges";
import { areaLabel } from "./access-labels";

const HINTS: Record<string, string> = {
  "needs-view": "Needs View",
  "needs-manage": "Needs Manage",
  "needs-full": "Needs Full",
  "switched-off": "Switched off for this person",
  "granted-individually": "Granted individually",
  "full-switched-off": "Withheld at Full",
};

/** Extra lines under some areas, pointing to the area that holds the rest. */
const AREA_FOOTNOTES: Partial<Record<OpsFeature, { text: string; area: OpsFeature }>> = {
  finance: { text: "Cleaner pay rates, payroll and cleaner invoices are in", area: "payroll" },
  "lost-found": { text: "Messages to guests are sent from the item; the message centre is in", area: "communications" },
};

/** "1 of 6" plus whether the area includes sensitive actions. */
export function capabilityCount(policy: OpsPolicy, userId: string, area: OpsFeature): { allowed: number; total: number; sensitive: boolean } {
  const list = capabilitiesForArea(area);
  const allowed = effectiveCapabilities(policy, userId);
  return {
    allowed: list.filter((capability) => allowed[capability.key as CapabilityKey]).length,
    total: list.length,
    sensitive: list.some((capability) => capability.tier === "full"),
  };
}

export function AccessCapabilities({
  draft,
  userId,
  personName,
  area,
  editable,
  onToggle,
}: {
  draft: OpsPolicy;
  userId: string;
  personName: string;
  area: OpsFeature;
  editable: boolean;
  onToggle: (key: CapabilityKey, on: boolean) => void;
}) {
  const allowed = effectiveCapabilities(draft, userId);
  const levels = resolveAccessLevels(draft, userId);
  const footnote = AREA_FOOTNOTES[area];
  return (
    <div>
      <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
        {capabilitiesForArea(area).map((capability) => {
          const key = capability.key as CapabilityKey;
          const source = capabilitySource(draft, userId, key);
          const locked = !editable || capability.tier === "view" || source === "needs-manage" || source === "needs-full" || source === "needs-view";
          const hint = capability.tier === "view" && source === "level" ? "Comes with View" : HINTS[source];
          return (
            <label key={key} className="flex items-start gap-2 text-[0.8125rem]">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[hsl(var(--e-primary))]"
                checked={allowed[key]}
                disabled={locked}
                onChange={(event) => onToggle(key, event.target.checked)}
              />
              <span>
                {capability.label} {capability.tier === "full" ? <SensitiveBadge /> : null}
                {hint || capability.note ? (
                  <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{hint ?? capability.note}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      {footnote ? (
        <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          {footnote.text} <b>{areaLabel(footnote.area)}</b>, which is {levels[footnote.area] === "off" ? "Off" : "on"} for {personName}.
        </p>
      ) : null}
    </div>
  );
}
