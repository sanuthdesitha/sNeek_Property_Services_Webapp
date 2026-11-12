"use client";

/**
 * The left list of queues, grouped by kind with their real waiting counts.
 * Queues with nothing waiting are folded under "Empty queues N" (opened
 * automatically when the selected queue is one of them, e.g. a deep link).
 */
import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { APPROVAL_QUEUES, APPROVAL_QUEUE_GROUPS, APPROVAL_QUEUE_ORDER, type ApprovalsQueueKey } from "@/lib/admin/approvals/queues";
import type { QueueSelection } from "./use-approvals-state";

type QueueNavProps = {
  counts: Partial<Record<ApprovalsQueueKey | "total", number>> | null;
  active: QueueSelection;
  onSelect: (queue: QueueSelection) => void;
};

function QueueButton({ label, count, active, onClick }: { label: string; count: number | null; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex min-h-[36px] w-full items-center justify-between gap-2 rounded-[6px] px-2 text-left text-[0.8125rem] font-[500] text-[hsl(var(--e-text-secondary))]",
        "hover:bg-[hsl(var(--e-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
        active && "bg-[hsl(var(--e-primary-soft))] font-[600] text-[hsl(var(--e-primary))] hover:bg-[hsl(var(--e-primary-soft))]",
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
      {count != null ? <span className="e-tnum font-[600]">{count}</span> : null}
    </button>
  );
}

export function QueueNav({ counts, active, onSelect }: QueueNavProps) {
  const countOf = (key: ApprovalsQueueKey) => (counts ? counts[key] ?? 0 : null);
  const empty = APPROVAL_QUEUE_ORDER.filter((key) => countOf(key) === 0);
  const activeIsEmpty = active !== "all" && empty.includes(active);
  const [showEmpty, setShowEmpty] = React.useState(false);
  const emptyOpen = showEmpty || activeIsEmpty;
  const listId = React.useId();

  return (
    <nav aria-label="Queues" className="flex flex-col gap-0.5">
      <QueueButton label="All waiting" count={counts?.total ?? null} active={active === "all"} onClick={() => onSelect("all")} />
      <div className="my-1.5 h-px bg-[hsl(var(--e-border))]" />
      {APPROVAL_QUEUE_GROUPS.map((group) => {
        const keys = APPROVAL_QUEUE_ORDER.filter((key) => APPROVAL_QUEUES[key].group === group.key && countOf(key) !== 0);
        if (keys.length === 0) return null;
        return (
          <div key={group.key} className="flex flex-col gap-0.5">
            <p className="e-eyebrow px-2 pb-1 pt-2">{group.label}</p>
            {keys.map((key) => (
              <QueueButton key={key} label={APPROVAL_QUEUES[key].label} count={countOf(key)} active={active === key} onClick={() => onSelect(key)} />
            ))}
          </div>
        );
      })}
      {empty.length > 0 ? (
        <>
          <div className="my-1.5 h-px bg-[hsl(var(--e-border))]" />
          <button
            type="button"
            aria-expanded={emptyOpen}
            aria-controls={listId}
            onClick={() => setShowEmpty((open) => !open)}
            className="flex min-h-[36px] w-full items-center justify-between rounded-[6px] px-2 text-left text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
          >
            <span>Empty queues <span className="e-tnum">{empty.length}</span></span>
            {emptyOpen ? <ChevronDown aria-hidden className="h-3.5 w-3.5" /> : <ChevronRight aria-hidden className="h-3.5 w-3.5" />}
          </button>
          {emptyOpen ? (
            <div id={listId} className="flex flex-col gap-0.5">
              {empty.map((key) => (
                <QueueButton key={key} label={APPROVAL_QUEUES[key].label} count={0} active={active === key} onClick={() => onSelect(key)} />
              ))}
            </div>
          ) : (
            <p id={listId} className="px-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              {empty.map((key) => APPROVAL_QUEUES[key].label).join(", ")}
            </p>
          )}
        </>
      ) : null}
    </nav>
  );
}
