"use client";

/**
 * One restore for the whole page: the header's "Restore job" and the
 * cancelled notice's conflict choices (Restore without them / Restore anyway /
 * Keep cancelled) share it, so a conflict found from the header shows in the
 * notice with the existing choices.
 */
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RestoreJobConflicts, useRestoreJob } from "../restore-job-control";

type RestoreContextValue = ReturnType<typeof useRestoreJob>;

const RestoreContext = createContext<RestoreContextValue | null>(null);

export function JobRestoreProvider({ jobId, children }: { jobId: string; children: ReactNode }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const value = useRestoreJob(jobId, refresh);
  return <RestoreContext.Provider value={value}>{children}</RestoreContext.Provider>;
}

export function useJobRestore(): RestoreContextValue | null {
  return useContext(RestoreContext);
}

export type CancelledLeadProps = {
  cancelledLine: string;
  reason: string | null;
  restoreRefusal: string | null;
};

/** The cancelled state's lead block: who, when and why, then the restore outcome or choices. */
export function CancelledLead({ cancelledLine, reason, restoreRefusal }: CancelledLeadProps) {
  const restore = useJobRestore();
  return (
    <section
      aria-label="Cancelled job"
      className="space-y-2 rounded-[var(--e-radius-lg)] bg-[hsl(var(--e-danger-soft))] px-4 py-3 text-[0.8125rem]"
    >
      <p className="font-[600]">{cancelledLine}</p>
      <p>
        <span className="text-[hsl(var(--e-muted-foreground))]">Reason:</span> {reason ?? "No reason was recorded."}
      </p>
      {restoreRefusal ? <p className="text-[hsl(var(--e-muted-foreground))]">{restoreRefusal}</p> : null}
      {restore && restore.state.kind !== "idle" ? (
        <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
          <p className="font-[600]">Restore job</p>
          {restore.state.kind === "saving" ? <p role="status">Restoring…</p> : null}
          <RestoreJobConflicts state={restore.state} restore={restore.restore} reset={restore.reset} />
        </div>
      ) : restore ? (
        <RestoreJobConflicts state={restore.state} restore={restore.restore} reset={restore.reset} />
      ) : null}
      <p className="text-[hsl(var(--e-muted-foreground))]">Everything recorded before the cancel stays readable in the timeline.</p>
    </section>
  );
}
