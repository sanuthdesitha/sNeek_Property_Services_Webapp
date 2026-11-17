"use client";

/**
 * "The office changed the guest timing" notice on the cleaner's job screen.
 *
 * The start gate asks for the briefing before a cleaner's first start only.
 * When the office changes the late checkout or early check-in time after the
 * cleaner confirmed it, or the cleaner is already working without a recorded
 * confirmation, this notice sits under the timing banners (which already show
 * the new time) and re-opens the same briefing dialog. The reading is saved
 * by POST /api/cleaner/jobs/[id]/briefing-ack with the fingerprint of the
 * list shown, so a change made while reading is caught and read again.
 *
 * Nothing is sent to anyone: this is an in-app notice only.
 */
import * as React from "react";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { StartBriefingDialog } from "@/components/v2/cleaner/start-briefing-dialog";
import {
  startBriefingHash,
  type ResolvedStartBriefingItem,
  type StartBriefingAckEntry,
} from "@/lib/forms/start-briefing";
import type { OwnTimingAckStatus } from "@/lib/jobs/job-page/timing-ack";

export type TimingAckPayload = { status: OwnTimingAckStatus; items: ResolvedStartBriefingItem[] };

const STATUSES: readonly OwnTimingAckStatus[] = ["none", "current", "changed", "notAcknowledged", "unreadable"];

/** Read the job payload's `timingAck` defensively; anything unexpected reads as "unreadable". */
export function readTimingAckPayload(raw: unknown): TimingAckPayload | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return { status: "unreadable", items: [] };
  const record = raw as Record<string, unknown>;
  const status = STATUSES.includes(record.status as OwnTimingAckStatus) ? (record.status as OwnTimingAckStatus) : "unreadable";
  const items = Array.isArray(record.items)
    ? (record.items as ResolvedStartBriefingItem[]).filter((item) => item && typeof item.id === "string" && typeof item.title === "string")
    : [];
  return { status, items };
}

/** Whether the notice applies: a changed confirmation always; a missing one once the job is underway. */
export function timingReconfirmNeeded(ack: TimingAckPayload | null, jobUnderway: boolean): boolean {
  if (!ack || ack.items.length === 0) return false;
  if (ack.status === "changed") return true;
  return ack.status === "notAcknowledged" && jobUnderway;
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "failed"; message: string };

type TimingReconfirmProps = {
  jobId: string;
  ack: TimingAckPayload | null;
  /** The cleaner's work on this job has started (clock running or paused). */
  jobUnderway: boolean;
  /** Re-read the job after a save or a change found while saving. */
  onSaved: () => void | Promise<void>;
};

export function TimingReconfirm({ jobId, ack, jobUnderway, onSaved }: TimingReconfirmProps) {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<ResolvedStartBriefingItem[]>([]);
  const [stale, setStale] = React.useState(false);
  const [save, setSave] = React.useState<SaveState>({ kind: "idle" });

  // A different job is a different briefing: never carry a dialog across.
  React.useEffect(() => {
    setOpen(false);
    setItems([]);
    setStale(false);
    setSave({ kind: "idle" });
  }, [jobId]);

  if (ack?.status === "unreadable" && jobUnderway) {
    return (
      <EAlert tone="warning" title="Timing confirmation could not be checked">
        Read the guest timing above and ask the office if anything is unclear.
      </EAlert>
    );
  }
  if (!timingReconfirmNeeded(ack, jobUnderway) || !ack) return null;

  const changed = ack.status === "changed";

  function openDialog(nextItems: ResolvedStartBriefingItem[], isStale: boolean) {
    setItems(nextItems);
    setStale(isStale);
    setOpen(true);
  }

  async function confirm(entries: StartBriefingAckEntry[]) {
    const shownHash = startBriefingHash(items);
    setOpen(false);
    setSave({ kind: "saving" });
    try {
      const response = await fetch(`/api/cleaner/jobs/${encodeURIComponent(jobId)}/briefing-ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startBriefingAck: entries, startBriefingHash: shownHash }),
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (response.ok) {
        setSave({ kind: "idle" });
        await onSaved();
        return;
      }
      if (body?.code === "START_BRIEFING_REQUIRED" && Array.isArray(body.items)) {
        // Changed again while they read: show the new list straight away.
        setSave({ kind: "idle" });
        openDialog(body.items as ResolvedStartBriefingItem[], true);
        return;
      }
      if (body?.code === "BRIEFING_CHANGED") await onSaved();
      setSave({ kind: "failed", message: typeof body?.error === "string" ? body.error : "Your confirmation was not saved. Try again." });
    } catch {
      setSave({ kind: "failed", message: "Your confirmation was not saved. Check your connection and try again." });
    }
  }

  return (
    <>
      <EAlert tone="warning" title={changed ? "The office changed the guest timing" : "Confirm the guest timing"}>
        <p>
          {changed
            ? "The time changed after you confirmed it. Read the new time above, then confirm."
            : "No confirmation of the guest timing is recorded for you. Read it, then confirm."}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <EButton variant="gold" size="sm" disabled={save.kind === "saving"} onClick={() => openDialog(ack.items, changed)}>
            {save.kind === "saving" ? "Saving…" : "Read and confirm"}
          </EButton>
          {save.kind === "failed" ? <span role="alert" className="text-[0.8125rem]">{save.message}</span> : null}
        </div>
      </EAlert>
      <StartBriefingDialog
        open={open}
        items={items}
        stale={stale}
        mode="reconfirm"
        onClose={() => setOpen(false)}
        onComplete={(entries) => void confirm(entries)}
      />
    </>
  );
}
