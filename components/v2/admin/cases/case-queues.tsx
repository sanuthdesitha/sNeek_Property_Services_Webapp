"use client";

/**
 * The Queues rail (desktop) and the queue/type selectors that replace it on a
 * phone. Counts are the server's real totals; a count still loading shows
 * nothing rather than a guess.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { EFilterChips, E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { CASE_QUEUES, CASE_QUEUE_LABELS, CASE_TYPES } from "@/lib/cases/queues";
import { E_INPUT_CLASS } from "@/components/v2/admin/estate-kit";
import { CASE_TYPE_LABELS, type CaseQueue, type CaseQueueCounts, type CaseTypeCounts } from "./case-types";

/** Order as drawn, then the two views kept from the old screen. */
const RAIL_ORDER: CaseQueue[] = ["needsReply", "unowned", "waitingClient", "slaRisk", "open", "resolved", "mine", "all"];

type Props = {
  queue: CaseQueue;
  caseType: string;
  counts: CaseQueueCounts | null;
  typeCounts: CaseTypeCounts | null;
  onQueue: (queue: CaseQueue) => void;
  onType: (caseType: string) => void;
};

const RAIL_BUTTON = cn(E_CHIP_CLASS, "h-8 w-full justify-between rounded-[8px]");

export function CaseQueuesRail({ queue, caseType, counts, typeCounts, onQueue, onType }: Props) {
  return (
    <section aria-label="Queues" className="hidden w-[190px] shrink-0 flex-col gap-1.5 pr-3.5 lg:flex">
      <p className="e-eyebrow">Queues</p>
      {RAIL_ORDER.map((key) => (
        <button key={key} type="button" aria-pressed={queue === key} onClick={() => onQueue(key)} className={cn(RAIL_BUTTON, queue === key && E_CHIP_ON_CLASS)}>
          <span className="truncate">{CASE_QUEUE_LABELS[key]}</span>
          {counts ? <b className="e-tnum">{counts[key]}</b> : null}
        </button>
      ))}
      <p className="e-eyebrow mt-2.5">Type</p>
      <div className="flex flex-wrap gap-1.5">
        {CASE_TYPES.map((type) => {
          const active = caseType === type;
          return (
            <button key={type} type="button" aria-pressed={active} onClick={() => onType(active ? "" : type)} className={cn(E_CHIP_CLASS, "rounded-[8px]", active && E_CHIP_ON_CLASS)}>
              {CASE_TYPE_LABELS[type]}
              {typeCounts ? <span className="e-tnum">{typeCounts[type]}</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Below lg the rail collapses into two labelled selectors. */
export function CaseQueueSelectors({ queue, caseType, counts, typeCounts, onQueue, onType }: Props) {
  const queueId = React.useId();
  const typeId = React.useId();
  return (
    <div className="grid grid-cols-2 gap-2 lg:hidden">
      <div className="min-w-0 space-y-1">
        <label htmlFor={queueId} className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Queue</label>
        <select id={queueId} className={cn(E_INPUT_CLASS, "min-h-11 text-[16px]")} value={queue} onChange={(event) => onQueue(event.target.value as CaseQueue)}>
          {RAIL_ORDER.filter((key) => (CASE_QUEUES as readonly string[]).includes(key)).map((key) => (
            <option key={key} value={key}>
              {CASE_QUEUE_LABELS[key]}{counts ? ` (${counts[key]})` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-0 space-y-1">
        <label htmlFor={typeId} className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Type</label>
        <select id={typeId} className={cn(E_INPUT_CLASS, "min-h-11 text-[16px]")} value={caseType} onChange={(event) => onType(event.target.value)}>
          <option value="">All types</option>
          {CASE_TYPES.map((type) => (
            <option key={type} value={type}>
              {CASE_TYPE_LABELS[type]}{typeCounts ? ` (${typeCounts[type]})` : ""}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * Phones (below 640px, board "Admin phone: Cases"): the queues as one
 * swipeable chip row with the server's counts. Type moves into the list's
 * Filter (see CaseList `typeFilter`).
 */
export function CaseQueueChips({ queue, counts, onQueue }: Pick<Props, "queue" | "counts" | "onQueue">) {
  return (
    <EFilterChips
      label="Queue"
      phoneLayout="carousel"
      active={queue}
      onChange={onQueue}
      chips={RAIL_ORDER.filter((key) => (CASE_QUEUES as readonly string[]).includes(key)).map((key) => ({
        key,
        label: CASE_QUEUE_LABELS[key],
        count: counts ? counts[key] : null,
      }))}
    />
  );
}
