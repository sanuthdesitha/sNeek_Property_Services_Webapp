"use client";

/**
 * Sticky job header shown on every stage. Property code large, full wrapping
 * address (tap to copy), and three always-visible actions: Navigate (Google
 * Maps), Call (opens the ContactSheet), Info (opens the PropertyInfoDrawer).
 * A live "time on site" chip appears once the cleaner is clocked in.
 */
import * as React from "react";
import { Navigation, Phone, Info, Check, Copy, Pause, Play } from "lucide-react";
import { EBadge } from "@/components/v2/ui/primitives";
import { cn } from "@/lib/utils";
import { LiveTimerChip } from "@/components/v2/cleaner/job-stages/parts";
import { titleCase, type WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";

function statusTone(status: string) {
  switch (status) {
    case "ASSIGNED":
    case "EN_ROUTE":
      return "primary" as const;
    case "IN_PROGRESS":
      return "info" as const;
    case "PAUSED":
    case "SUBMITTED":
      return "warning" as const;
    case "QA_REVIEW":
      return "aubergine" as const;
    case "COMPLETED":
    case "INVOICED":
      return "success" as const;
    default:
      return "neutral" as const;
  }
}

export function JobHeader({ api }: { api: WorkspaceApi }) {
  const { propertyCode, addressLine, navUrl, status, timeState } = api;
  const [copied, setCopied] = React.useState(false);
  // Badge count for the Info button: must-read items + a key-pickup instruction
  // are the things cleaners most often miss because the drawer was invisible.
  const infoCount =
    (api.readFirstItems?.length ?? 0) + (api.payload?.keyPickupLocation ? 1 : 0);

  async function copyAddress() {
    if (!addressLine) return;
    try {
      await navigator.clipboard.writeText(addressLine);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  return (
    <header className="sticky top-16 z-20 -mx-4 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface)/0.92)] px-4 py-3 backdrop-blur lg:top-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="e-display-sm leading-tight">{propertyCode || "Job"}</p>
            <EBadge tone={statusTone(status)} soft>
              {titleCase(status || "")}
            </EBadge>
            <LiveTimerChip timeState={timeState} />
            <HeaderClockControl api={api} />
          </div>
          <button
            type="button"
            onClick={copyAddress}
            disabled={!addressLine}
            className="mt-1 flex items-start gap-1.5 text-left text-[0.8125rem] text-[hsl(var(--e-text-secondary))] disabled:opacity-70"
            aria-label="Copy address"
          >
            <span className="whitespace-normal break-words">{addressLine || "Address not set"}</span>
            {addressLine ? (
              copied ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-success))]" />
              ) : (
                <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-text-faint))]" />
              )
            ) : null}
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <HeaderAction
            label="Navigate"
            href={navUrl || undefined}
            disabled={!navUrl}
          >
            <Navigation className="h-4 w-4" />
          </HeaderAction>
          <HeaderAction label="Call" onClick={api.openContactSheet}>
            <Phone className="h-4 w-4" />
          </HeaderAction>
          {/* Property info holds access codes, key pickup and READ-FIRST notes —
              too important to sit as a third anonymous icon. Labelled + accented,
              with a count badge when there are must-read items. */}
          <button
            type="button"
            onClick={api.openInfoDrawer}
            aria-label="Property info"
            className="relative inline-flex h-10 items-center gap-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] px-2.5 text-[0.8125rem] font-[600] text-[hsl(var(--e-gold-ink))] transition-colors hover:brightness-95"
          >
            <Info className="h-4 w-4" />
            <span className="hidden xs:inline">Info</span>
            {infoCount > 0 ? (
              <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(var(--e-gold))] px-1 text-[0.625rem] font-[700] leading-none text-[hsl(var(--e-gold-foreground))]">
                {infoCount}
              </span>
            ) : null}
          </button>
        </div>
      </div>
    </header>
  );
}

/**
 * Pause / resume the clock, from ANY stage.
 *
 * The only clock control used to live inside StageSetup (stage 3), and clocking
 * in auto-advances the workspace to stage 4 — so the Pause button unmounted at
 * the exact moment it became useful, and a cleaner had no way to pause a job
 * short of navigating backwards to a step marked complete. That is why "jobs
 * cannot be paused in v2". The header is on every stage, so the control lives
 * here now; StageSetup keeps its larger card for the initial clock-in.
 *
 * Resume is offered too: a job can reach PAUSED without the cleaner touching
 * anything, because the geofence sweep closes the time log server-side when
 * they leave the site.
 */
function HeaderClockControl({ api }: { api: WorkspaceApi }) {
  const isRunning = Boolean(api.timeState?.isRunning);
  const paused = api.status === "PAUSED";
  // Nothing to pause and nothing to resume — the initial clock-in belongs to
  // the setup stage's full card, not to a 32px header button.
  if (api.locked) return null;
  if (!isRunning && !paused) return null;

  const busy = api.busy === "pause" || api.busy === "clockIn";
  const label = isRunning ? "Pause clock" : "Resume clock";

  return (
    <button
      type="button"
      onClick={isRunning ? api.pauseClock : api.clockIn}
      disabled={busy || (!isRunning && api.clockInDisabled)}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--e-radius-pill)] border px-2 py-1 text-[0.75rem] font-[600] transition-colors disabled:opacity-50",
        isRunning
          ? "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))]"
          : "border-[hsl(var(--e-success))] bg-[hsl(var(--e-success-soft))] text-[hsl(var(--e-success))]"
      )}
    >
      {isRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      <span>{isRunning ? "Pause" : "Resume"}</span>
    </button>
  );
}

function HeaderAction({
  label,
  href,
  onClick,
  disabled,
  children,
}: {
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const cls = cn(
    "flex h-10 w-10 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] transition-colors hover:bg-[hsl(var(--e-muted))]",
    disabled && "pointer-events-none opacity-40"
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls} aria-label={label} title={label}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls} aria-label={label} title={label}>
      {children}
    </button>
  );
}
