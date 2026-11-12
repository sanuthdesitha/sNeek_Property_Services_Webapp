"use client";

/**
 * Small shared pieces for the Approvals side panel: section boxes, a detail
 * list, the two-step confirm button the queues have always used, and the
 * decision contract every queue's panel receives.
 */
import * as React from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { EButton } from "@/components/v2/ui/primitives";
import type { ApprovalQueueRow } from "@/lib/admin/approvals/rows";

export type DecideRequest = {
  url: string;
  method?: "PATCH" | "POST";
  body: object;
  successMsg: string;
};

/** Runs one decision through its existing route. Resolves true on success. */
export type Decide = (request: DecideRequest) => Promise<boolean>;

export type QueuePanelProps = {
  row: ApprovalQueueRow;
  busy: boolean;
  decide: Decide;
  reload: () => Promise<void>;
  timezone: string;
};

export function formatInstant(value: string | null | undefined, timezone: string, pattern = "d MMM yyyy HH:mm"): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return formatInTimeZone(date, timezone, pattern);
}

/** A calendar date ("2026-11-10" or an ISO instant at UTC midnight) without a timezone shift. */
export function formatDay(value: string | null | undefined): string {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return "—";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return formatInTimeZone(date, "UTC", "EEE d MMM yyyy");
}

export function PanelSection({ title, children, tone }: { title: string; children: React.ReactNode; tone?: "decision" }) {
  return (
    <section
      aria-label={title}
      className={
        "flex flex-col gap-2 rounded-[10px] border px-3 py-2.5 " +
        (tone === "decision" ? "border-[hsl(var(--e-primary)/0.35)]" : "border-[hsl(var(--e-border))]")
      }
    >
      <p className="e-eyebrow">{title}</p>
      {children}
    </section>
  );
}

export function DetailList({ items }: { items: Array<[string, React.ReactNode] | null | false> }) {
  const rows = items.filter((item): item is [string, React.ReactNode] => Boolean(item));
  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[0.8125rem]">
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-[hsl(var(--e-muted-foreground))]">{label}</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function PanelNote({ children }: { children: React.ReactNode }) {
  return <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{children}</p>;
}

export function ContextLinks({ links }: { links: Array<{ href: string; label: string } | null> }) {
  const shown = links.filter((link): link is { href: string; label: string } => Boolean(link));
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3 text-[0.8125rem]">
      {shown.map((link) => (
        <Link key={link.href + link.label} href={link.href} className="text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
          {link.label}
        </Link>
      ))}
    </div>
  );
}

/**
 * Two-step confirm for a decision that cannot be quietly undone: the first
 * click arms it ("Confirm …?"), the second within four seconds runs it.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  variant = "outline",
  disabled,
  onConfirm,
}: {
  label: React.ReactNode;
  confirmLabel: string;
  variant?: "gold" | "outline" | "danger";
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return (
    <EButton
      size="sm"
      variant={armed ? "danger" : variant}
      disabled={disabled}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirmLabel : label}
    </EButton>
  );
}

export function jobHref(row: ApprovalQueueRow): string | null {
  return row.jobId ? `/v2/admin/jobs/${row.jobId}` : null;
}
