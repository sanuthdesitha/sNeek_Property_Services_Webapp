"use client";

/**
 * "Restore" for a cancelled job (Wave E, 2026-11):
 *  POST /api/admin/jobs/:id/restore
 * The server returns the job to the unstarted status it was cancelled from,
 * with its released cleaners, if the slot rules still pass. When they do not
 * (leave, clash, outside the roster, the day has passed) it answers 409 with
 * each conflict; the office then restores anyway (explicit override) or
 * restores without the conflicting cleaners.
 *
 * `useRestoreJob` holds the request and its state so the job page's header
 * button and the cancelled notice share one restore; `RestoreJobConflicts`
 * renders the conflict choices; `RestoreJobControl` is the compact control the
 * peek panel uses.
 */
import { useCallback, useEffect, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";

export type RestoreConflict = { userId: string | null; name: string | null; reason: string };

export type RestoreState =
  | { kind: "idle"; message: string | null; error: string | null }
  | { kind: "saving" }
  | { kind: "conflicts"; conflicts: RestoreConflict[] };

export type RestoreOptions = { confirmConflicts?: boolean; skipUserIds?: string[] };

type RestoreResponse = {
  error?: string;
  code?: string;
  conflicts?: RestoreConflict[];
  status?: string;
  notRestored?: Array<{ reason: string }>;
  noticeError?: string | null;
};

const IDLE: RestoreState = { kind: "idle", message: null, error: null };

export function useRestoreJob(jobId: string, onRestored: () => void) {
  const [state, setState] = useState<RestoreState>(IDLE);
  useEffect(() => setState(IDLE), [jobId]);

  const restore = useCallback(
    async (options: RestoreOptions = {}) => {
      setState({ kind: "saving" });
      try {
        const response = await fetch(`/api/admin/jobs/${encodeURIComponent(jobId)}/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options),
        });
        const body = (await response.json().catch(() => ({}))) as RestoreResponse;
        if (response.status === 409 && body.code === "RESTORE_CONFLICT" && Array.isArray(body.conflicts)) {
          setState({ kind: "conflicts", conflicts: body.conflicts });
          return;
        }
        if (!response.ok) throw new Error(body.error ?? "Could not restore the job.");
        const left = body.notRestored?.length ?? 0;
        const status = String(body.status ?? "").toLowerCase().replace(/_/g, " ");
        const leftText = left ? ` ${left} cleaner${left === 1 ? " was" : "s were"} not put back.` : "";
        setState({ kind: "idle", error: null, message: `Restored as ${status}.${leftText}${body.noticeError ? ` ${body.noticeError}` : ""}` });
        onRestored();
      } catch (error) {
        setState({ kind: "idle", message: null, error: error instanceof Error ? error.message : "Could not restore the job." });
      }
    },
    [jobId, onRestored],
  );

  const reset = useCallback(() => setState(IDLE), []);
  return { state, restore, reset };
}

export function RestoreJobConflicts({
  state,
  restore,
  reset,
}: {
  state: RestoreState;
  restore: (options?: RestoreOptions) => Promise<void>;
  reset: () => void;
}) {
  if (state.kind === "conflicts") {
    const skipIds = state.conflicts.flatMap((row) => (row.userId ? [row.userId] : []));
    const dayOnly = skipIds.length === 0;
    return (
      <div role="alert" className="space-y-2">
        <ul className="space-y-1 text-[hsl(var(--e-warning))]">
          {state.conflicts.map((row) => (
            <li key={`${row.userId ?? "day"}:${row.reason}`}>
              {row.name ? `${row.name}: ` : ""}
              {row.reason}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {!dayOnly ? <EButton size="sm" onClick={() => void restore({ skipUserIds: skipIds })}>Restore without them</EButton> : null}
          <EButton size="sm" variant="outline" onClick={() => void restore({ confirmConflicts: true })}>Restore anyway</EButton>
          <EButton size="sm" variant="ghost" onClick={reset}>Keep cancelled</EButton>
        </div>
      </div>
    );
  }
  if (state.kind === "idle" && state.message) return <p role="status">{state.message}</p>;
  if (state.kind === "idle" && state.error) return <p role="alert" className="text-[hsl(var(--e-danger))] [overflow-wrap:anywhere]">{state.error}</p>;
  return null;
}

export function RestoreJobControl({ jobId, cancelReason, readOnly, onRestored }: { jobId: string; cancelReason?: string | null; readOnly: boolean; onRestored: () => void }) {
  const { state, restore, reset } = useRestoreJob(jobId, onRestored);
  return (
    <div role="group" aria-label="Cancelled job" className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-sunken))] px-3 py-2.5 text-[0.8125rem]">
      <p><span className="font-[600]">Cancelled.</span>{cancelReason ? ` Reason: ${cancelReason}` : ""}</p>
      {state.kind !== "conflicts" ? (
        <EButton size="sm" variant="outline" disabled={readOnly || state.kind === "saving"} onClick={() => void restore()}>
          {state.kind === "saving" ? "Restoring…" : "Restore"}
        </EButton>
      ) : null}
      <RestoreJobConflicts state={state} restore={restore} reset={reset} />
    </div>
  );
}
