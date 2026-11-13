"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ACCESS_LEVEL_LABELS, OPS_FEATURES, type AccessLevel, type OpsFeature } from "@/lib/rbac/ops-catalog";
import { resolveAccessLevels, type OpsPolicy } from "@/lib/rbac/ops-policy";
import type { CapabilityKey } from "@/lib/rbac/capabilities";
import { AccessCapabilities, capabilityCount } from "./access-capabilities";
import { AccessLevelControl } from "./access-level-control";
import { SensitiveBadge } from "./access-badges";
import { GROUP_ORDER, plainLabel } from "./access-labels";
import { AccessAreaRows } from "./access-phone";
import { useIsPhone } from "@/components/v2/ui/use-phone";

type Feature = (typeof OPS_FEATURES)[number];

const cell = "px-3 py-1.5 align-middle";
const groupRow = "bg-[hsl(var(--e-surface-raised))] px-3 py-1.5 text-[0.65625rem] font-[600] uppercase tracking-[0.1em] text-[hsl(var(--e-gold-ink))]";

function ToggleButton({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--e-radius)] text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--e-ring))]"
    >
      {open ? <ChevronDown aria-hidden className="h-4 w-4" /> : <ChevronRight aria-hidden className="h-4 w-4" />}
    </button>
  );
}

/**
 * The selected person's access over every real area, grouped as the catalog
 * groups them. Areas that are Off in both the draft and the saved version
 * fold into one row per group; each area with capabilities expands.
 */
export function AccessMatrix({
  draft,
  saved,
  userId,
  personName,
  editable,
  onLevel,
  onCapability,
}: {
  draft: OpsPolicy;
  saved: OpsPolicy;
  userId: string;
  personName: string;
  editable: boolean;
  onLevel: (area: OpsFeature, level: AccessLevel) => void;
  onCapability: (key: CapabilityKey, on: boolean) => void;
}) {
  const phone = useIsPhone();
  const [openAreas, setOpenAreas] = useState<Set<string>>(new Set());
  const [openFolds, setOpenFolds] = useState<Set<string>>(new Set());
  const levels = resolveAccessLevels(draft, userId);
  const savedLevels = resolveAccessLevels(saved, userId);
  const toggle = (set: Set<string>, key: string, update: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    update(next);
  };

  function areaRow(feature: Feature) {
    const level = levels[feature.key];
    const count = capabilityCount(draft, userId, feature.key);
    const open = openAreas.has(feature.key);
    const changed = level !== savedLevels[feature.key];
    const label = plainLabel(feature.label);
    return (
      <Fragment key={feature.key}>
        <tr className={changed || open ? "bg-[hsl(var(--e-primary-soft)/0.35)]" : undefined}>
          <td className={cell}>
            <span className={level === "manage" || level === "full" ? "font-[600]" : undefined}>{label}</span>
          </td>
          <td className={cell}>
            <AccessLevelControl value={level} saved={savedLevels[feature.key]} label={label} disabled={!editable} onChange={(next) => onLevel(feature.key, next)} />
            {changed ? (
              <span className="mt-0.5 block text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                Was {ACCESS_LEVEL_LABELS[savedLevels[feature.key]]} · not saved
              </span>
            ) : null}
          </td>
          <td className={`${cell} text-[0.8125rem]`}>
            {count.total === 0 ? (
              <span className="text-[hsl(var(--e-muted-foreground))]">None</span>
            ) : (
              <span>
                {count.allowed} of {count.total} {count.sensitive ? <SensitiveBadge short /> : null}
              </span>
            )}
          </td>
          <td className={cell}>
            {count.total > 0 ? (
              <ToggleButton open={open} label={`${open ? "Hide" : "Show"} ${label} capabilities`} onClick={() => toggle(openAreas, feature.key, setOpenAreas)} />
            ) : null}
          </td>
        </tr>
        {open ? (
          <tr>
            <td colSpan={4} className="bg-[hsl(var(--e-surface-sunken)/0.5)] py-2.5 pl-7 pr-3">
              <AccessCapabilities draft={draft} userId={userId} personName={personName} area={feature.key} editable={editable} onToggle={onCapability} />
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  }

  // Phones: one row per area with a level button and sheet (same draft calls).
  if (phone) {
    return <AccessAreaRows draft={draft} saved={saved} userId={userId} personName={personName} editable={editable} onLevel={onLevel} onCapability={onCapability} />;
  }

  return (
    <div className="overflow-x-auto rounded-[var(--e-radius-lg)] max-sm:hidden border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <table className="w-full min-w-[560px] border-collapse text-[0.875rem]">
        <caption className="sr-only">Access for {personName} by area</caption>
        <thead>
          <tr className="border-b border-[hsl(var(--e-border))] text-left text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            <th scope="col" className={cell}>Area</th>
            <th scope="col" className={`${cell} w-[220px]`}>Level</th>
            <th scope="col" className={`${cell} w-[118px]`}>Extras</th>
            <th scope="col" className={`${cell} w-10`}><span className="sr-only">Details</span></th>
          </tr>
        </thead>
        <tbody>
          {GROUP_ORDER.map((group) => {
            const features = OPS_FEATURES.filter((feature) => feature.group === group);
            const folded = features.filter((feature) => levels[feature.key] === "off" && savedLevels[feature.key] === "off");
            const shown = features.filter((feature) => !folded.includes(feature));
            const onCount = features.filter((feature) => levels[feature.key] !== "off").length;
            const foldOpen = openFolds.has(group);
            return (
              <Fragment key={group}>
                <tr>
                  <td colSpan={4} className={groupRow}>
                    {plainLabel(group)}
                    {features.length > 1 ? ` · ${onCount} of ${features.length} on` : ""}
                  </td>
                </tr>
                {shown.map(areaRow)}
                {folded.length > 0 && !foldOpen ? (
                  <tr>
                    <td className={`${cell} text-[0.8125rem]`}>{folded.map((feature) => plainLabel(feature.label)).join(" · ")}</td>
                    <td className={`${cell} text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]`}>
                      {folded.length === 1 ? "Off" : `${folded.length} areas, all Off`}
                    </td>
                    <td className={cell} />
                    <td className={cell}>
                      <ToggleButton open={false} label={`Show ${folded.length} ${folded.length === 1 ? "area" : "areas"}`} onClick={() => toggle(openFolds, group, setOpenFolds)} />
                    </td>
                  </tr>
                ) : null}
                {foldOpen ? folded.map(areaRow) : null}
                {foldOpen && folded.length > 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-1 text-right">
                      <button type="button" className="text-[0.75rem] underline" onClick={() => toggle(openFolds, group, setOpenFolds)}>
                        Fold the Off areas
                      </button>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
