"use client";

/**
 * Moving runs to another day: the dialog (one run or several) and the call to
 * POST /api/admin/laundry/reschedule. Each run answers done or refused with its
 * reason (including "changed since you loaded it"); refused runs are listed,
 * never reported as moved.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal } from "@/components/v2/admin/estate-kit";
import type { RescheduleOutcome } from "@/lib/laundry/reschedule";

export type MoveTarget = { id: string; name: string; updatedAt: string };

export async function requestMove(targets: MoveTarget[], toDate: string): Promise<RescheduleOutcome[]> {
  const response = await fetch("/api/admin/laundry/reschedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toDate, rows: targets.map((target) => ({ id: target.id, expectedUpdatedAt: target.updatedAt })) }),
  });
  const body = (await response.json().catch(() => ({}))) as { results?: RescheduleOutcome[]; error?: string };
  if (!response.ok) throw new Error(body.error || "Could not move the runs.");
  return Array.isArray(body.results) ? body.results : [];
}

export type MoveReport = { moved: number; refused: Array<{ name: string; reason: string }> };

export function summarizeMove(targets: MoveTarget[], results: RescheduleOutcome[]): MoveReport {
  const names = new Map(targets.map((target) => [target.id, target.name]));
  return {
    moved: results.filter((row) => row.outcome === "done").length,
    refused: results.flatMap((row) => (row.outcome === "refused" ? [{ name: names.get(row.id) ?? row.id, reason: row.reason }] : [])),
  };
}

type Props = {
  targets: MoveTarget[] | null;
  defaultDate: string;
  onClose: () => void;
  onMoved: (report: MoveReport) => void;
};

export function LaundryMoveDialog({ targets, defaultDate, onClose, onMoved }: Props) {
  const [date, setDate] = React.useState(defaultDate);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    if (targets) {
      setDate(defaultDate);
      setError("");
    }
  }, [targets, defaultDate]);

  async function submit() {
    if (!targets?.length) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Choose a day.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      onMoved(summarizeMove(targets, await requestMove(targets, date)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not move the runs.");
    } finally {
      setBusy(false);
    }
  }

  const count = targets?.length ?? 0;
  return (
    <EModal open={Boolean(targets)} onClose={onClose} title={count === 1 ? `Reschedule ${targets?.[0]?.name ?? "run"}` : `Reschedule ${count} runs`} eyebrow="Laundry">
      <fieldset disabled={busy} className="space-y-4">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Runs not yet picked up move their pickup to this day and keep the same gap to drop-off. Runs at the laundry move only their drop-off. Delivered or skipped runs are refused. A run changed since this page loaded is refused, not overwritten.
        </p>
        <EField label="Move to">
          <EInput type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </EField>
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <EButton size="sm" variant="outline" onClick={onClose}>Cancel</EButton>
          <EButton size="sm" onClick={() => void submit()}>{busy ? "Moving…" : "Move"}</EButton>
        </div>
      </fieldset>
    </EModal>
  );
}
