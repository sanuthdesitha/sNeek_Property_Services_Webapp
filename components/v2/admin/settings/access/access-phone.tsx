"use client";

/**
 * Access and permissions on a phone (board "M-Permissions", 2026-11). Rendered
 * only below 640px (callers gate on useIsPhone); from 640px up the matrix,
 * by-area radio rows and side column are unchanged.
 *
 * The 34-by-4 matrix becomes one row per area with a single level button.
 * Tapping it opens a bottom sheet holding the very same AccessLevelControl and
 * AccessCapabilities the desktop matrix uses, so a level or capability chosen
 * here goes through the same draft calls and saves the same payload.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { EBottomSheet } from "@/components/v2/ui/bottom-sheet";
import { EButton } from "@/components/v2/ui/primitives";
import { cn } from "@/lib/utils";
import { ACCESS_LEVEL_LABELS, OPS_FEATURES, type AccessLevel, type OpsFeature } from "@/lib/rbac/ops-catalog";
import { resolveAccessLevels, type OpsPolicy } from "@/lib/rbac/ops-policy";
import type { CapabilityKey } from "@/lib/rbac/capabilities";
import { AccessCapabilities, capabilityCount } from "./access-capabilities";
import { AccessLevelControl } from "./access-level-control";
import { SensitiveBadge } from "./access-badges";
import { GROUP_ORDER, plainLabel } from "./access-labels";

type Feature = (typeof OPS_FEATURES)[number];

/** The level button's colour follows the desktop control: Full is gold, View and Manage primary. */
function levelButtonClass(level: AccessLevel, changed: boolean): string {
  return cn(
    "inline-flex min-h-11 shrink-0 items-center gap-1 rounded-[var(--e-radius)] border px-3 text-[0.8125rem] font-[600] disabled:opacity-60",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--e-ring))]",
    level === "off" && "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-sunken))] text-[hsl(var(--e-text-secondary))]",
    (level === "read" || level === "manage") && "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]",
    level === "full" && "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-foreground))]",
    changed && "shadow-[0_0_0_2px_hsl(var(--e-gold))]",
  );
}

type LevelSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: AccessLevel;
  saved: AccessLevel;
  /** The radiogroup's label, exactly as the desktop control names it (e.g. "Finance and invoicing"). */
  label: string;
  /** Sheet title; defaults to `label`. */
  title?: string;
  /** One line under the sheet title (the area's group). */
  description?: string;
  /** Who the level is for, used in the "Was Off" line. */
  personName: string;
  disabled: boolean;
  onChange: (level: AccessLevel) => void;
  /** The area's capabilities and footnotes, under the level selector. */
  children?: ReactNode;
};

/** The level sheet: the desktop radio group on top, the area's capabilities below. */
export function AccessLevelSheet({ open, onOpenChange, value, saved, label, title, description, personName, disabled, onChange, children }: LevelSheetProps) {
  const changed = value !== saved;
  return (
    <EBottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title ?? label}
      description={description}
      footer={<EButton className="w-full" onClick={() => onOpenChange(false)}>Done</EButton>}
    >
      <div className="flex flex-col gap-3">
        <div className="[&>[role=radiogroup]]:flex [&>[role=radiogroup]]:w-full [&_[role=radio]]:min-h-11 [&_[role=radio]]:flex-1 [&_[role=radio]]:text-[0.875rem]">
          <AccessLevelControl value={value} saved={saved} label={label} disabled={disabled} onChange={onChange} />
        </div>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          {changed ? `Was ${ACCESS_LEVEL_LABELS[saved]} for ${personName}, not saved yet. ` : ""}
          <b>Off</b> hidden · <b>View</b> look, not change · <b>Manage</b> everyday actions · <b>Full</b> adds sensitive actions, asked for the person&apos;s own PIN.
        </p>
        {children}
      </div>
    </EBottomSheet>
  );
}

/** The "View ▾" trigger on a row. */
export function AccessLevelButton({ value, saved, label, disabled, expanded, onClick }: { value: AccessLevel; saved: AccessLevel; label: string; disabled: boolean; expanded: boolean; onClick: () => void }) {
  const changed = value !== saved;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-label={`${label}: ${ACCESS_LEVEL_LABELS[value]}${changed ? ", not saved" : ""}. ${disabled ? "Show" : "Change"} level`}
      onClick={onClick}
      className={levelButtonClass(value, changed)}
    >
      {ACCESS_LEVEL_LABELS[value]}
      <ChevronDown aria-hidden className="h-3.5 w-3.5" />
    </button>
  );
}

/** A level button that owns its sheet (By area: one per person, in a stable list). */
export function AccessLevelSheetButton(props: Omit<LevelSheetProps, "open" | "onOpenChange">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <AccessLevelButton value={props.value} saved={props.saved} label={props.label} disabled={props.disabled} expanded={open} onClick={() => setOpen(true)} />
      <AccessLevelSheet {...props} open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * The selected person's areas, one row each, grouped as the catalog groups
 * them; areas Off in both the draft and the saved version fold per group.
 */
export function AccessAreaRows({
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
  const [openFolds, setOpenFolds] = useState<ReadonlySet<string>>(new Set());
  // One sheet for the whole list, so it stays open when a row moves out of its fold.
  const [openArea, setOpenArea] = useState<OpsFeature | null>(null);
  const levels = resolveAccessLevels(draft, userId);
  const savedLevels = resolveAccessLevels(saved, userId);

  function toggleFold(group: string) {
    setOpenFolds((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  function areaRow(feature: Feature) {
    const level = levels[feature.key];
    const was = savedLevels[feature.key];
    const label = plainLabel(feature.label);
    const count = capabilityCount(draft, userId, feature.key);
    const detail = level !== was
      ? `Was ${ACCESS_LEVEL_LABELS[was]} · not saved`
      : count.total === 0 ? "No extras" : `${count.allowed} of ${count.total} extras`;
    return (
      <li key={feature.key} className={cn("flex min-h-14 items-center gap-3 px-3 py-2", level !== was && "bg-[hsl(var(--e-primary-soft)/0.35)]")}>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-[0.875rem] [overflow-wrap:anywhere]", level !== "off" && "font-[600]")}>{label}</span>
          <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            {detail} {count.sensitive ? <SensitiveBadge short /> : null}
          </span>
        </span>
        <AccessLevelButton value={level} saved={was} label={label} disabled={!editable} expanded={openArea === feature.key} onClick={() => setOpenArea(feature.key)} />
      </li>
    );
  }

  const sheetFeature = openArea ? OPS_FEATURES.find((feature) => feature.key === openArea) ?? null : null;
  const sheetCount = sheetFeature ? capabilityCount(draft, userId, sheetFeature.key) : null;

  return (
    <div className="flex flex-col gap-3" aria-label={`Access for ${personName} by area`} role="group">
      {sheetFeature && sheetCount ? (
        <AccessLevelSheet
          open
          onOpenChange={(open) => { if (!open) setOpenArea(null); }}
          value={levels[sheetFeature.key]}
          saved={savedLevels[sheetFeature.key]}
          label={plainLabel(sheetFeature.label)}
          description={plainLabel(sheetFeature.group)}
          personName={personName}
          disabled={!editable}
          onChange={(next) => onLevel(sheetFeature.key, next)}
        >
          {sheetCount.total > 0 ? (
            <AccessCapabilities draft={draft} userId={userId} personName={personName} area={sheetFeature.key} editable={editable} onToggle={onCapability} />
          ) : (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">This area has no extra capabilities.</p>
          )}
        </AccessLevelSheet>
      ) : null}
      {GROUP_ORDER.map((group) => {
        const features = OPS_FEATURES.filter((feature) => feature.group === group);
        if (features.length === 0) return null;
        const folded = features.filter((feature) => levels[feature.key] === "off" && savedLevels[feature.key] === "off");
        const shown = features.filter((feature) => !folded.includes(feature));
        const onCount = features.length - features.filter((feature) => levels[feature.key] === "off").length;
        const foldOpen = openFolds.has(group);
        return (
          <section key={group} aria-label={plainLabel(group)} className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
            <div className="flex items-center justify-between gap-2 bg-[hsl(var(--e-surface-raised))] px-3 py-2">
              <p className="text-[0.6875rem] font-[600] uppercase tracking-[0.1em] text-[hsl(var(--e-gold-ink))]">
                {plainLabel(group)}{features.length > 1 ? ` · ${onCount} of ${features.length} on` : ""}
              </p>
              {foldOpen && folded.length > 0 ? (
                <button type="button" className="min-h-11 px-1 text-[0.75rem] underline" onClick={() => toggleFold(group)}>Fold Off areas</button>
              ) : null}
            </div>
            <ul className="m-0 list-none divide-y divide-[hsl(var(--e-border))] p-0">
              {shown.map((feature) => areaRow(feature))}
              {foldOpen ? folded.map((feature) => areaRow(feature)) : null}
              {folded.length > 0 && !foldOpen ? (
                <li className="flex min-h-14 items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 text-[0.8125rem]">
                    <span className="block font-[550]">{folded.length === 1 ? "1 area Off" : `${folded.length} areas Off`}</span>
                    <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{folded.map((feature) => plainLabel(feature.label)).join(", ")}</span>
                  </span>
                  <button
                    type="button"
                    aria-expanded={false}
                    aria-label={`Show ${folded.length} ${folded.length === 1 ? "area" : "areas"} in ${plainLabel(group)}`}
                    onClick={() => toggleFold(group)}
                    className="inline-flex min-h-11 items-center gap-1 rounded-[var(--e-radius)] px-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]"
                  >
                    Show <ChevronRight aria-hidden className="h-3.5 w-3.5" />
                  </button>
                </li>
              ) : null}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** "‹ Name" bar at the top of a phone sub-screen. */
export function AccessPhoneBack({ title, subtitle, backLabel, onBack }: { title: string; subtitle?: string; backLabel: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={backLabel}
        onClick={onBack}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-text-secondary))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--e-ring))]"
      >
        <ChevronLeft aria-hidden className="h-5 w-5" />
      </button>
      <span className="min-w-0">
        <span className="block truncate text-[0.9375rem] font-[600]">{title}</span>
        {subtitle ? <span className="block truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{subtitle}</span> : null}
      </span>
    </div>
  );
}
