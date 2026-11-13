"use client";

/**
 * Command work queue: everything that needs a decision, most urgent first,
 * with the decision on the row where an existing endpoint allows it.
 *
 * A request action shows pending, then the server's answer. Only a confirmed
 * success removes the row (and the queue is re-read); a refusal keeps the row
 * and shows the server's reason. Assign opens the shared Jobs peek panel.
 */
import { useEffect, useRef, useState } from "react";
import { EFilterChips } from "@/components/v2/ui/filter-chips";
import { JobPeekPanel } from "@/components/v2/admin/jobs/job-peek-panel";
import type { WorkQueueAction, WorkQueueChipKey, WorkQueueItem, WorkQueuePayload } from "@/lib/dashboard/work-queue-types";
import { runQueueRequest } from "./queue-actions";
import { SectionBody } from "./section-state";
import { useCommandSection } from "./use-command-section";
import { WorkQueueRow, type RowStatus } from "./work-queue-row";
import { DeclineReasonDialog } from "../office-actions/decline-reason-dialog";
import { DocumentReminderDialog } from "./document-reminder-dialog";

type RequestAction = Extract<WorkQueueAction, { kind: "request" }>;
type ReasonRequest = { item: WorkQueueItem; action: RequestAction & { reason: NonNullable<RequestAction["reason"]> } };
type ReminderAction = Extract<WorkQueueAction, { kind: "document-reminder" }>;
type ReminderRequest = { item: WorkQueueItem; action: ReminderAction };

const IDLE: RowStatus = { pending: null, error: null };

type QueueProps = { initial: WorkQueuePayload | null; timeZone: string; readOnly: boolean };

export function WorkQueue({ initial, timeZone, readOnly }: QueueProps) {
  const state = useCommandSection<WorkQueuePayload>("queue", initial);
  const [chip, setChip] = useState<WorkQueueChipKey>("all");
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});
  const [done, setDone] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [peekJobId, setPeekJobId] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<ReasonRequest | null>(null);
  const [reminderFor, setReminderFor] = useState<ReminderRequest | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // Rows confirmed done stay hidden until the next read no longer has them.
  useEffect(() => {
    if (!state.data) return;
    const ids = new Set(state.data.items.map((item) => item.id));
    setDone((current) => current.filter((id) => ids.has(id)));
  }, [state.data]);

  function confirmed(item: WorkQueueItem, action: RequestAction) {
    setStatuses((current) => ({ ...current, [item.id]: IDLE }));
    setDone((current) => [...current, item.id]);
    setAnnouncement(`${action.doneLabel}: ${item.title}`);
    state.reload();
  }

  function onRowRequest(item: WorkQueueItem, action: RequestAction) {
    // An action that needs a reason (continuation decline) asks for it in the
    // same dialog Live ops uses; the reason travels in the existing body field.
    if (action.reason) setReasonFor({ item, action: { ...action, reason: action.reason } });
    else void request(item, action);
  }

  async function request(item: WorkQueueItem, action: RequestAction) {
    setStatuses((current) => ({ ...current, [item.id]: { pending: action.label, error: null } }));
    const result = await runQueueRequest(action);
    if (!mounted.current) return;
    if (result.ok) {
      confirmed(item, action);
    } else {
      setStatuses((current) => ({ ...current, [item.id]: { pending: null, error: result.message } }));
      setAnnouncement(`Not done: ${result.message}`);
    }
  }

  return (
    <section id="work-queue" aria-labelledby="work-queue-title" className="flex min-w-0 flex-col rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <div className="flex flex-col gap-3 border-b border-[hsl(var(--e-border))] px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 id="work-queue-title" className="text-[0.8125rem] font-[600]">Work queue</h2>
          <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Everything that needs a decision, most urgent first. Act here without opening the page.</p>
        </div>
        {state.data ? (
          <EFilterChips
            label="Filter the work queue"
            chips={state.data.chips}
            active={state.data.chips.some((entry) => entry.key === chip) ? chip : "all"}
            onChange={setChip}
            phoneLayout="carousel"
          />
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      <SectionBody state={state} label="The work queue" timeZone={timeZone} rows={5}>
        {(data) => {
          const active = data.chips.some((entry) => entry.key === chip) ? chip : "all";
          const items = data.items.filter((item) => !done.includes(item.id) && (active === "all" || item.category === active));
          return (
            <>
              {data.unavailable.length > 0 ? (
                <p role="alert" className="border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-warning-soft))] px-4 py-2 text-[0.75rem] text-[hsl(var(--e-warning))]">
                  Not shown because they could not be read: {data.unavailable.join(", ")}. The queue may be incomplete.
                </p>
              ) : null}
              {items.length === 0 ? (
                <p className="px-4 py-10 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  {data.unavailable.length > 0 ? "Nothing to show from the sources that could be read." : "Nothing needs a decision right now."}
                </p>
              ) : (
                <ul aria-label="Work queue items" className="min-w-0 max-sm:py-1">
                  {items.map((item) => (
                    <WorkQueueRow
                      key={item.id}
                      item={item}
                      status={statuses[item.id] ?? IDLE}
                      onRequest={onRowRequest}
                      onAssign={setPeekJobId}
                      onDocumentReminder={(row, action) => setReminderFor({ item: row, action })}
                    />
                  ))}
                </ul>
              )}
            </>
          );
        }}
      </SectionBody>
      <DeclineReasonDialog
        open={reasonFor !== null}
        subject={reasonFor?.action.reason.subject ?? ""}
        onClose={() => setReasonFor(null)}
        onSubmit={(reason) => {
          const pending = reasonFor;
          if (!pending) return Promise.resolve({ ok: false as const, message: "Nothing to decline." });
          return runQueueRequest({ ...pending.action, body: { ...pending.action.body, [pending.action.reason.field]: reason } });
        }}
        onDeclined={() => {
          const pending = reasonFor;
          setReasonFor(null);
          if (pending && mounted.current) confirmed(pending.item, pending.action);
        }}
      />
      {reminderFor ? (
        <DocumentReminderDialog
          key={reminderFor.item.id}
          documentId={reminderFor.action.documentId}
          endpoint={reminderFor.action.endpoint}
          timeZone={timeZone}
          onClose={() => setReminderFor(null)}
          onSent={() => setAnnouncement(`Reminder requested: ${reminderFor.item.title}`)}
        />
      ) : null}
      <JobPeekPanel jobId={peekJobId} row={null} readOnly={readOnly} onClose={() => setPeekJobId(null)} onChanged={state.reload} />
    </section>
  );
}
