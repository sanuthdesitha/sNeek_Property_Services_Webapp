"use client";

/**
 * "Restore" for a cancelled job (Wave E, 2026-11):
 *  POST /api/admin/jobs/:id/restore
 * The server returns the job to the unstarted status it was cancelled from,
 * with its released cleaners, if the slot rules still pass. When they do not
 * (leave, clash, outside the roster, the day has passed) it answers 409 with
 * each conflict; the office then restores anyway (explicit override) or
 * restores without the conflicting cleaners.
 */
import { useEffect, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";

type Conflict = { userId: string | null; name: string | null; reason: string };

type State =
  | { kind: "idle"; message: string | null; error: string | null }
  | { kind: "saving" }
  | { kind: "conflicts"; conflicts: Conflict[] };

export function RestoreJobControl({ jobId, cancelReason, readOnly, onRestored }: { jobId: string; cancelReason?: string | null; readOnly: boolean; onRestored: () => void }) {
  const [state, setState] = useState<State>({ kind: "idle", message: null, error: null });
  useEffect(() => setState({ kind: "idle", message: null, error: null }), [jobId]);

  async function restore(options: { confirmConflicts?: boolean; skipUserIds?: string[] } = {}) {
    const forJob = jobId;
    setState({ kind: "saving" });
    try {
      const response = await fetch(`/api/admin/jobs/${encodeURIComponent(forJob)}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string; conflicts?: Conflict[]; status?: string; notRestored?: Array<{ reason: string }>; noticeError?: string | null };
      if (response.status === 409 && body.code === "RESTORE_CONFLICT" && Array.isArray(body.conflicts)) {
        setState({ kind: "conflicts", conflicts: body.conflicts });
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "Could not restore the job.");
      const left = body.notRestored?.length ?? 0;
      setState({ kind: "idle", error: null, message: `Restored as ${String(body.status ?? "").toLowerCase().replace(/_/g, " ")}.${left ? ` ${left} cleaner${left === 1 ? " was" : "s were"} not put back.` : ""}${body.noticeError ? ` ${body.noticeError}` : ""}` });
      onRestored();
    } catch (error) {
      setState({ kind: "idle", message: null, error: error instanceof Error ? error.message : "Could not restore the job." });
    }
  }

  const skipIds = state.kind === "conflicts" ? state.conflicts.flatMap((row) => (row.userId ? [row.userId] : [])) : [];
  const dayOnly = state.kind === "conflicts" && skipIds.length === 0;
  return (
    <div role="group" aria-label="Cancelled job" className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-sunken))] px-3 py-2.5 text-[0.8125rem]">
      <p><span className="font-[600]">Cancelled.</span>{cancelReason ? ` Reason: ${cancelReason}` : ""}</p>
      {state.kind === "conflicts" ? (
        <div role="alert" className="space-y-2">
          <ul className="space-y-1 text-[hsl(var(--e-warning))]">
            {state.conflicts.map((row) => <li key={`${row.userId ?? "day"}:${row.reason}`}>{row.name ? `${row.name}: ` : ""}{row.reason}</li>)}
          </ul>
          <div className="flex flex-wrap gap-2">
            <EButton size="sm" variant="outline" onClick={() => void restore({ confirmConflicts: true })}>Restore anyway</EButton>
            {!dayOnly ? <EButton size="sm" variant="outline" onClick={() => void restore({ skipUserIds: skipIds })}>Restore without them</EButton> : null}
            <EButton size="sm" variant="ghost" onClick={() => setState({ kind: "idle", message: null, error: null })}>Keep cancelled</EButton>
          </div>
        </div>
      ) : (
        <EButton size="sm" variant="outline" disabled={readOnly || state.kind === "saving"} onClick={() => void restore()}>
          {state.kind === "saving" ? "Restoring…" : "Restore"}
        </EButton>
      )}
      {state.kind === "idle" && state.message ? <p role="status">{state.message}</p> : null}
      {state.kind === "idle" && state.error ? <p role="alert" className="text-[hsl(var(--e-danger))] [overflow-wrap:anywhere]">{state.error}</p> : null}
    </div>
  );
}
