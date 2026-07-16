"use client";

/**
 * Sticky job header shown on every stage. Property code large, full wrapping
 * address (tap to copy), and three always-visible actions: Navigate (Google
 * Maps), Call (opens the ContactSheet), Info (opens the PropertyInfoDrawer).
 * A live "time on site" chip appears once the cleaner is clocked in.
 */
import * as React from "react";
import { Navigation, Phone, Info, Check, Copy } from "lucide-react";
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
          <HeaderAction label="Info" onClick={api.openInfoDrawer}>
            <Info className="h-4 w-4" />
          </HeaderAction>
        </div>
      </div>
    </header>
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
