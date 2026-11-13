/**
 * Tone bands — the replacement for the coloured left-edge line on flagged
 * cards, rows and notices (owner decision 2026-11: design B, the tinted title
 * band, colour set 1 "Honey and wine"). Tokens: `--e-band-<tone>-*` in
 * app/v2/estate.css, light and Obsidian dark.
 *
 * Three shapes:
 *  - card:   the title row becomes the band (rounded top follows the card,
 *            hairline under it); the body stays on the plain surface.
 *  - row:    a tint behind the row's leading cell, no left line.
 *  - notice: a whole inline callout takes the tint with a hairline border.
 *
 * Colour is never the only signal: a flagged card or row keeps its written
 * reason pill/badge. A card with nothing to flag stays plain (pass no tone).
 *
 * Deliberately a plain module (no "use client", no hooks): server pages and
 * client components can both import the helpers and the components.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

/** attention = honey (was warning/amber), problem = wine (was danger/red),
 *  good = sage (was success/green), info = sky (was info/blue). */
export type ETone = "attention" | "problem" | "good" | "info";

export const E_TONES: readonly ETone[] = ["attention", "problem", "good", "info"];

/* Class strings are written out in full so Tailwind's JIT finds them. */
const BAND_COLOURS: Record<ETone, string> = {
  attention:
    "bg-[hsl(var(--e-band-attention-bg))] border-[hsl(var(--e-band-attention-line))] text-[hsl(var(--e-band-attention-fg))]",
  problem:
    "bg-[hsl(var(--e-band-problem-bg))] border-[hsl(var(--e-band-problem-line))] text-[hsl(var(--e-band-problem-fg))]",
  good: "bg-[hsl(var(--e-band-good-bg))] border-[hsl(var(--e-band-good-line))] text-[hsl(var(--e-band-good-fg))]",
  info: "bg-[hsl(var(--e-band-info-bg))] border-[hsl(var(--e-band-info-line))] text-[hsl(var(--e-band-info-fg))]",
};

const MUTED_TEXT: Record<ETone, string> = {
  attention: "text-[hsl(var(--e-band-attention-muted))]",
  problem: "text-[hsl(var(--e-band-problem-muted))]",
  good: "text-[hsl(var(--e-band-good-muted))]",
  info: "text-[hsl(var(--e-band-info-muted))]",
};

const PILL_TEXT: Record<ETone, string> = {
  attention: "text-[hsl(var(--e-band-attention-pill))]",
  problem: "text-[hsl(var(--e-band-problem-pill))]",
  good: "text-[hsl(var(--e-band-good-pill))]",
  info: "text-[hsl(var(--e-band-info-pill))]",
};

const ROW_CELL: Record<ETone, string> = {
  attention: "bg-[hsl(var(--e-band-attention-bg))] text-[hsl(var(--e-band-attention-fg))]",
  problem: "bg-[hsl(var(--e-band-problem-bg))] text-[hsl(var(--e-band-problem-fg))]",
  good: "bg-[hsl(var(--e-band-good-bg))] text-[hsl(var(--e-band-good-fg))]",
  info: "bg-[hsl(var(--e-band-info-bg))] text-[hsl(var(--e-band-info-fg))]",
};

/** Card title band: tint, hairline below, band text colour. */
export function toneBandClass(tone: ETone): string {
  return cn("border-b", BAND_COLOURS[tone]);
}

/** Inline notice / callout: the whole box takes the tint with a hairline border. */
export function toneNoticeClass(tone: ETone): string {
  return cn("border", BAND_COLOURS[tone]);
}

/** Secondary text inside a band or notice. */
export function toneMutedClass(tone: ETone): string {
  return MUTED_TEXT[tone];
}

/** Reason pill sitting in a band: surface background, tone text. */
export function tonePillClass(tone: ETone): string {
  return cn(
    "inline-flex shrink-0 items-center whitespace-nowrap rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-surface))] px-2.5 py-0.5 text-[0.6875rem] font-semibold",
    PILL_TEXT[tone],
  );
}

/** Put on an existing EBadge/EPill that sits in a band, so it reads on the
 *  surface colour as the design shows. `!` beats EBadge's inline soft tint. */
export const E_BAND_BADGE_CLASS = "!bg-[hsl(var(--e-surface))]";

/** Table/list row: tint behind the leading cell (no left line). */
export function toneRowCellClass(tone: ETone): string {
  return ROW_CELL[tone];
}

/** Phones only (below 640px): the band colours, for a list row that turns
 *  into a card with a title band on a phone and stays a plain row from 640px
 *  up (board "Admin phone", e.g. the Command work queue). */
const PHONE_BAND: Record<ETone, string> = {
  attention: "max-sm:bg-[hsl(var(--e-band-attention-bg))] max-sm:border-[hsl(var(--e-band-attention-line))] max-sm:text-[hsl(var(--e-band-attention-fg))]",
  problem: "max-sm:bg-[hsl(var(--e-band-problem-bg))] max-sm:border-[hsl(var(--e-band-problem-line))] max-sm:text-[hsl(var(--e-band-problem-fg))]",
  good: "max-sm:bg-[hsl(var(--e-band-good-bg))] max-sm:border-[hsl(var(--e-band-good-line))] max-sm:text-[hsl(var(--e-band-good-fg))]",
  info: "max-sm:bg-[hsl(var(--e-band-info-bg))] max-sm:border-[hsl(var(--e-band-info-line))] max-sm:text-[hsl(var(--e-band-info-fg))]",
};
export function tonePhoneBandClass(tone: ETone): string {
  return cn("max-sm:border-b", PHONE_BAND[tone]);
}

/** Map the older semantic tone names onto band tones. */
export type ELegacyTone = "warning" | "danger" | "success" | "info";
const LEGACY_TO_BAND: Record<ELegacyTone, ETone> = {
  warning: "attention",
  danger: "problem",
  success: "good",
  info: "info",
};
export function toneFromLegacy(tone: ELegacyTone): ETone {
  return LEGACY_TO_BAND[tone];
}

/* ── Components ─────────────────────────────────────────────────────────── */

/** The band itself, for a card whose header markup is its own. Put it first
 *  inside a card that has `overflow-hidden` (or use EToneCard). */
export function EToneBand({
  tone,
  className,
  children,
}: {
  tone: ETone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-tone={tone} className={cn(toneBandClass(tone), className)}>
      {children}
    </div>
  );
}

/** A reason pill in a band. */
export function ETonePill({ tone, className, children }: { tone: ETone; className?: string; children: React.ReactNode }) {
  return <span className={cn(tonePillClass(tone), className)}>{children}</span>;
}

type EToneCardProps = {
  /** Omit (or null) for a card with nothing to flag: the top stays plain. */
  tone?: ETone | null;
  /** Title row content (left side). */
  header: React.ReactNode;
  /** Written reason, shown in the band on a surface background. Required to flag. */
  pill?: React.ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children">;

/** Card whose title row becomes the band when flagged. */
export function EToneCard({
  tone,
  header,
  pill,
  className,
  headerClassName,
  bodyClassName,
  children,
  ...rest
}: EToneCardProps) {
  const headerRow = (
    <>
      <div className="min-w-0 flex-1">{header}</div>
      {/* The pill may wrap but never takes more than about half the row, so a long value
          ("Airbnb turnover · not a rework · …") cannot squeeze the title to one letter per line. */}
      {pill ? tone ? <ETonePill tone={tone} className="max-w-[55%] whitespace-normal break-words">{pill}</ETonePill> : <span className="max-w-[55%] shrink-0 break-words text-right">{pill}</span> : null}
    </>
  );
  return (
    <div
      data-tone={tone ?? undefined}
      className={cn(
        "overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))]",
        className,
      )}
      {...rest}
    >
      {tone ? (
        <EToneBand tone={tone} className={cn("flex items-start justify-between gap-2.5 px-3.5 py-2.5", headerClassName)}>
          {headerRow}
        </EToneBand>
      ) : (
        <div className={cn("flex items-start justify-between gap-2.5 px-3.5 pt-3", headerClassName)}>{headerRow}</div>
      )}
      {children ? <div className={cn("px-3.5 py-3", bodyClassName)}>{children}</div> : null}
    </div>
  );
}

/** Leading cell of a flagged table row. Other cells stay plain. */
export function EToneRowCell({
  tone,
  className,
  children,
  ...rest
}: { tone?: ETone | null } & React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td data-tone={tone ?? undefined} className={cn(tone ? toneRowCellClass(tone) : undefined, className)} {...rest}>
      {children}
    </td>
  );
}

/** Inline notice / callout with the band tint (replaces the left-bar notice). */
export function EToneNotice({
  tone,
  title,
  className,
  children,
  ...rest
}: {
  tone: ETone;
  title?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "title" | "children">) {
  return (
    <div data-tone={tone} className={cn("rounded-[var(--e-radius-lg)] p-4", toneNoticeClass(tone), className)} {...rest}>
      {title ? <p className="text-[0.875rem] font-semibold">{title}</p> : null}
      {children ? <div className={cn("text-[0.8125rem]", toneMutedClass(tone))}>{children}</div> : null}
    </div>
  );
}
