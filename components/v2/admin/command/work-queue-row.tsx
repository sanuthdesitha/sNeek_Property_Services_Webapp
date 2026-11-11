"use client";

/** One work queue row: urgency, what it is, and its actions. */
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import type { WorkQueueAction, WorkQueueItem, WorkQueueUrgency } from "@/lib/dashboard/work-queue-types";

const URGENCY: Record<WorkQueueUrgency, { label: string; tone: EPillTone }> = {
  now: { label: "Now", tone: "bad" },
  today: { label: "Today", tone: "warn" },
  week: { label: "This week", tone: "neutral" },
};

export type RowStatus = { pending: string | null; error: string | null };

type RowProps = {
  item: WorkQueueItem;
  status: RowStatus;
  onRequest: (item: WorkQueueItem, action: Extract<WorkQueueAction, { kind: "request" }>) => void;
  onAssign: (jobId: string) => void;
};

function ActionControl({ action, item, status, onRequest, onAssign }: RowProps & { action: WorkQueueAction }) {
  const variant = action.primary ? "primary" : "outline";
  const busy = status.pending !== null;
  if (action.kind === "link") {
    return action.external ? (
      <EButton asChild size="sm" variant={variant}><a href={action.href}>{action.label}</a></EButton>
    ) : (
      <EButton asChild size="sm" variant={variant}><Link href={action.href}>{action.label}</Link></EButton>
    );
  }
  if (action.kind === "assign") {
    return <EButton size="sm" variant={variant} disabled={busy} onClick={() => onAssign(action.jobId)}>{action.label}</EButton>;
  }
  return (
    <EButton size="sm" variant={variant} disabled={busy} aria-busy={status.pending === action.label} onClick={() => onRequest(item, action)}>
      {status.pending === action.label ? `${action.label}…` : action.label}
    </EButton>
  );
}

export function WorkQueueRow(props: RowProps) {
  const { item, status } = props;
  const urgency = URGENCY[item.urgency];
  return (
    <li className="flex flex-col gap-2 border-b border-[hsl(var(--e-border))] px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-24 shrink-0"><EPill tone={urgency.tone}>{urgency.label}</EPill></span>
      <div className="min-w-0 flex-1">
        <Link href={item.href} className="font-[600] text-[hsl(var(--e-foreground))] [overflow-wrap:anywhere] hover:underline">
          {item.title}
        </Link>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{item.detail}</p>
        {status.error ? <p role="alert" className="mt-1 text-[0.75rem] text-[hsl(var(--e-danger))]">{status.error}</p> : null}
      </div>
      {item.actions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {item.actions.map((action) => <ActionControl key={`${action.kind}:${action.label}`} {...props} action={action} />)}
        </div>
      ) : null}
    </li>
  );
}
