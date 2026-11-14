/**
 * Live ops map pins as DOM (presentational, no Google types): drawn inside a
 * google.maps.OverlayView by estate-ops-map.tsx, and in tests and harnesses
 * on their own. Look from the approved designs (`.pin`): a surface pill with a
 * strong border, a round initials badge coloured by state, the short name and
 * a short status; late pins take a red border and text. Estate tokens only,
 * so the pins follow light and Obsidian dark (the map stays Google's style).
 *
 * Each person pin is a real button (Enter/Space activate it); its accessible
 * name carries every state the pill shows, so colour is never the only signal.
 */
import { Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { pinLabel, visibleGroupMembers, type PersonPin, type PinGroup, type PinTone, type PropertyPin } from "./ops-map-pins";

// ── Classes ────────────────────────────────────────────────────────────────

const BADGE_FILL: Record<PinTone, string> = {
  success: "border-[hsl(var(--e-success))] bg-[hsl(var(--e-success))]",
  danger: "border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger))]",
  warning: "border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning))]",
  info: "border-[hsl(var(--e-info))] bg-[hsl(var(--e-info))]",
  gold: "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold))]",
  neutral: "border-[hsl(var(--e-muted-foreground))] bg-[hsl(var(--e-muted-foreground))]",
};

/** Ink of a hollow badge (no GPS, shown at the job address). */
const BADGE_INK: Record<PinTone, string> = {
  success: "border-[hsl(var(--e-success))] text-[hsl(var(--e-success))]",
  danger: "border-[hsl(var(--e-danger))] text-[hsl(var(--e-danger))]",
  warning: "border-[hsl(var(--e-warning))] text-[hsl(var(--e-warning))]",
  info: "border-[hsl(var(--e-info))] text-[hsl(var(--e-info))]",
  gold: "border-[hsl(var(--e-gold))] text-[hsl(var(--e-gold))]",
  neutral: "border-[hsl(var(--e-muted-foreground))] text-[hsl(var(--e-muted-foreground))]",
};

export type PinLook = Pick<PersonPin, "initials" | "tone" | "alert" | "freshness" | "precision" | "selected">;

function badgeClass(look: PinLook): string {
  const hollow = look.precision === "job-address";
  return cn(
    "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] text-[9px] font-semibold leading-none",
    hollow ? cn("bg-[hsl(var(--e-surface))]", BADGE_INK[look.tone]) : cn(BADGE_FILL[look.tone], "text-[hsl(var(--e-surface))]"),
    // Freshness of the fix: a fading badge, as the old dot's age colour did.
    look.freshness === "aging" && "opacity-75",
    look.freshness === "stale" && "opacity-50 saturate-50",
  );
}

export function personPillClass(look: PinLook): string {
  return cn(
    "relative inline-flex h-[26px] max-w-[220px] items-center gap-1 whitespace-nowrap rounded-[var(--e-radius-pill)] border bg-[hsl(var(--e-surface))] py-0 pl-1 pr-2 text-[11.5px] font-semibold text-[hsl(var(--e-foreground))] shadow-[0_2px_6px_hsl(160_30%_10%/0.18)] max-sm:max-w-[200px] max-sm:text-[10.5px]",
    look.alert ? "border-[hsl(var(--e-danger))] text-[hsl(var(--e-danger))]" : "border-[hsl(var(--e-border-strong))]",
    look.precision === "approximate" && "border-[1.5px] border-dashed",
    look.precision === "approximate" && !look.alert && "border-[hsl(var(--e-muted-foreground))]",
    look.selected && "ring-2 ring-[hsl(var(--e-ring))] ring-offset-1 ring-offset-[hsl(var(--e-surface))]",
  );
}

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--e-foreground))]";

export function PinBadge({ look }: { look: PinLook }) {
  return <span className={badgeClass(look)} aria-hidden>{look.initials}</span>;
}

// ── People ─────────────────────────────────────────────────────────────────

export function PersonPinButton({ pin, onActivate }: { pin: PersonPin; onActivate: (pin: PersonPin) => void }) {
  const label = pinLabel(pin);
  return (
    <button
      type="button"
      className={cn(personPillClass(pin), "cursor-pointer", FOCUS)}
      aria-label={pin.ariaLabel}
      aria-pressed={pin.selected}
      title={pin.ariaLabel}
      data-pin-kind={pin.kind}
      data-pin-tone={pin.tone}
      onClick={() => onActivate(pin)}
    >
      <PinBadge look={pin} />
      <span className="min-w-0 truncate" aria-hidden>{label}</span>
    </button>
  );
}

/**
 * One overlap group, drawn at its anchor: the first (most urgent) pin's badge
 * sits on the point and the others stack above it. A collapsed large group
 * shows "+N" (a button that expands it); an expanded one shows "Fewer".
 */
export function PersonPinStack({
  group,
  expanded,
  selectedKey,
  onActivate,
  onToggle,
}: {
  group: PinGroup<PersonPin>;
  expanded: boolean;
  selectedKey: string | null;
  onActivate: (pin: PersonPin) => void;
  onToggle: (groupId: string) => void;
}) {
  const { visible, hiddenCount } = visibleGroupMembers(group, expanded, selectedKey);
  const canCollapse = expanded && visibleGroupMembers(group, false, selectedKey).hiddenCount > 0;
  const toggleClass = cn(
    "inline-flex h-[22px] items-center rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[10.5px] font-semibold text-[hsl(var(--e-foreground))] shadow-[0_2px_6px_hsl(160_30%_10%/0.18)]",
    FOCUS,
  );
  return (
    <div
      role="group"
      aria-label={group.members.length > 1 ? `${group.members.length} people at about the same place` : undefined}
      className="flex flex-col-reverse items-start gap-1"
    >
      {visible.map((pin) => <PersonPinButton key={pin.key} pin={pin} onActivate={onActivate} />)}
      {hiddenCount > 0 ? (
        <button type="button" className={toggleClass} aria-expanded={false} aria-label={`Show ${hiddenCount} more ${hiddenCount === 1 ? "person" : "people"} here`} onClick={() => onToggle(group.id)}>
          +{hiddenCount}
        </button>
      ) : null}
      {canCollapse ? (
        <button type="button" className={toggleClass} aria-expanded aria-label="Show fewer people here" onClick={() => onToggle(group.id)}>
          Fewer
        </button>
      ) : null}
    </div>
  );
}

// ── Properties ─────────────────────────────────────────────────────────────

/** A quiet house glyph in a rounded square: never a round initials badge. */
export function PropertyGlyph() {
  return (
    <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-muted))] text-[hsl(var(--e-muted-foreground))] shadow-[0_1px_2px_hsl(160_30%_10%/0.15)]" aria-hidden>
      <Home className="h-3 w-3" strokeWidth={2.25} />
    </span>
  );
}

export function PropertyPinButton({ pin, showLabel, onActivate }: { pin: PropertyPin; showLabel: boolean; onActivate: (pin: PropertyPin) => void }) {
  return (
    <button
      type="button"
      className={cn("inline-flex cursor-pointer items-center gap-1 rounded-[5px]", FOCUS)}
      aria-label={pin.ariaLabel}
      title={pin.ariaLabel}
      data-pin-kind="property"
      onClick={() => onActivate(pin)}
    >
      <PropertyGlyph />
      {showLabel ? (
        <span className="max-w-[180px] truncate rounded-[4px] bg-[hsl(var(--e-surface)/0.92)] px-1 text-[10.5px] font-medium leading-[16px] text-[hsl(var(--e-muted-foreground))]" aria-hidden>
          {pin.name}{pin.todayLabel ? ` · ${pin.todayLabel}` : ""}
        </span>
      ) : null}
    </button>
  );
}

// ── Legend ─────────────────────────────────────────────────────────────────

type LegendSample = { label: string; look: PinLook; text?: string };

const BASE_LOOK: PinLook = { initials: "AB", tone: "success", alert: false, freshness: "live", precision: "gps", selected: false };

const STATE_SAMPLES: LegendSample[] = [
  { label: "On site", look: { ...BASE_LOOK, tone: "success" } },
  { label: "On the way", look: { ...BASE_LOOK, tone: "info" } },
  { label: "Late", look: { ...BASE_LOOK, tone: "danger", alert: true }, text: "late" },
  { label: "Off site · left site · unsure", look: { ...BASE_LOOK, tone: "warning" } },
  { label: "Not started · paused · no fix · other", look: { ...BASE_LOOK, tone: "neutral" } },
];

const POSITION_SAMPLES: LegendSample[] = [
  { label: "Live fix (< 3 min)", look: { ...BASE_LOOK, tone: "info" } },
  { label: "Aging (< 10 min)", look: { ...BASE_LOOK, tone: "info", freshness: "aging" } },
  { label: "Stale (10 min +)", look: { ...BASE_LOOK, tone: "info", freshness: "stale" }, text: "stale fix" },
  { label: "Approximate (± over 100 m) · ring shows accuracy", look: { ...BASE_LOOK, tone: "info", precision: "approximate" }, text: "approx." },
  { label: "No GPS · shown at job address", look: { ...BASE_LOOK, tone: "neutral", precision: "job-address" }, text: "no GPS" },
  { label: "Selected", look: { ...BASE_LOOK, tone: "info", selected: true } },
];

function LegendPill({ sample }: { sample: LegendSample }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn(personPillClass(sample.look), "h-[22px] text-[10px] shadow-none max-sm:text-[10px]")} aria-hidden>
        <PinBadge look={sample.look} />
        {sample.text ? <span>{sample.text}</span> : null}
      </span>
      {sample.label}
    </span>
  );
}

export function OpsMapLegend({ showDrivers = true }: { showDrivers?: boolean }) {
  const row = "flex flex-wrap items-center gap-x-4 gap-y-1.5";
  return (
    <div className="space-y-2 px-4 py-2.5 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]" aria-label="Map key" role="group">
      <div className={row}>
        <span className="font-[550] text-[hsl(var(--e-foreground))]">Badge: state</span>
        {STATE_SAMPLES.map((sample) => <LegendPill key={sample.label} sample={sample} />)}
        {showDrivers ? <LegendPill sample={{ label: "Laundry driver", look: { ...BASE_LOOK, initials: "T", tone: "gold" } }} /> : null}
      </div>
      <div className={row}>
        <span className="font-[550] text-[hsl(var(--e-foreground))]">Pill: position</span>
        {POSITION_SAMPLES.map((sample) => <LegendPill key={sample.label} sample={sample} />)}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex h-[22px] items-center rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[10px] font-semibold text-[hsl(var(--e-foreground))]" aria-hidden>+2</span>
          More people at one spot (tap to show)
        </span>
        <span className="inline-flex items-center gap-1.5"><PropertyGlyph />Property (named when zoomed in or with a job today)</span>
      </div>
    </div>
  );
}
