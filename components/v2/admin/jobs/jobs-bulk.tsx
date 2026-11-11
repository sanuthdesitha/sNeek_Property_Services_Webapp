"use client";

/**
 * The Jobs bulk bar and its assign and QA dialogs. Each action is one server
 * request over the selection:
 * - Assign cleaner → `/api/admin/jobs/bulk-assign` (existing);
 * - Change status → the reviewed bulk-status flow (opened by the caller);
 * - Reschedule → `/api/admin/jobs/bulk-reschedule`: a preview from the
 *   Calendar's move check, then the existing reschedule service per row;
 * - Send reminder → `/api/admin/jobs/bulk-remind` with per-row outcomes;
 * - Assign QA → `/api/admin/qa/assignments` (existing);
 * - Export selected → the reviewed CSV export limited to the selection.
 */
import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { EButton } from "@/components/v2/ui/primitives";
import { BulkRemindDialog } from "./bulk-remind-dialog";
import { BulkRescheduleDialog } from "./bulk-reschedule-dialog";
import { JobsExportPreview } from "./export-preview";
import { JobDialog } from "./job-dialog";
import type { JobsPersonOption } from "./jobs-constants";

const FIELD = "h-10 w-full cursor-pointer rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.875rem]";

type BulkProps = {
  selectedIds: string[];
  cleaners: JobsPersonOption[];
  inspectors: JobsPersonOption[];
  exportQuery: string;
  viewsContext?: string;
  readOnly: boolean;
  onClear: () => void;
  onChangeStatus: () => void;
  /** Replace the selection (e.g. keep only rows that were not done) and reload. */
  onDone: (keepSelected: string[]) => void;
};

type ActiveDialog = "assign" | "reschedule" | "remind" | "qa" | null;

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, body: parsed };
}

export function JobsBulk({ selectedIds, cleaners, inspectors, exportQuery, viewsContext, readOnly, onClear, onChangeStatus, onDone }: BulkProps) {
  const [dialog, setDialog] = useState<ActiveDialog>(null);
  const [cleanerId, setCleanerId] = useState("");
  const [inspectorId, setInspectorId] = useState("");
  const [busy, setBusy] = useState(false);
  const count = selectedIds.length;

  async function bulkAssign() {
    if (count === 0 || !cleanerId) return;
    setBusy(true);
    try {
      const result = await postJson("/api/admin/jobs/bulk-assign", { jobIds: selectedIds, cleanerUserId: cleanerId });
      if (!result.ok) throw new Error(typeof result.body.error === "string" ? result.body.error : "Could not bulk assign jobs.");
      toast({ title: "Bulk assignment complete", description: `${Number(result.body.updated ?? count)} jobs updated.` });
      setDialog(null);
      onDone([]);
    } catch (error) {
      toast({ title: "Bulk assign failed", description: error instanceof Error ? error.message : "Request failed.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function bulkQa() {
    if (count === 0 || !inspectorId) return;
    setBusy(true);
    try {
      const result = await postJson("/api/admin/qa/assignments", { jobIds: selectedIds, assignedToId: inspectorId });
      if (!result.ok) throw new Error(typeof result.body.error === "string" ? result.body.error : "Could not create QA assignments.");
      const created = Number(result.body.created ?? count);
      const skipped = count - created;
      toast({ title: "QA assignments created", description: `${created} inspection${created === 1 ? "" : "s"} assigned${skipped > 0 ? `, ${skipped} skipped` : ""}.` });
      setDialog(null);
      onDone([]);
    } catch (error) {
      toast({ title: "Assign QA failed", description: error instanceof Error ? error.message : "Request failed.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <EBulkBar count={count} noun={{ one: "job", many: "jobs" }} onClear={onClear} busy={busy}
        className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-30 lg:bottom-4">
        <EBulkButton onClick={() => setDialog("assign")} disabled={readOnly}>Assign cleaner</EBulkButton>
        <EBulkButton onClick={onChangeStatus} disabled={readOnly}>Change status</EBulkButton>
        <EBulkButton onClick={() => setDialog("reschedule")} disabled={readOnly}>Reschedule</EBulkButton>
        <EBulkButton onClick={() => setDialog("remind")} disabled={readOnly}>Send reminder</EBulkButton>
        <EBulkButton onClick={() => setDialog("qa")} disabled={readOnly}>Assign QA</EBulkButton>
        <JobsExportPreview query={exportQuery} context={viewsContext} selectionCount={count}
          trigger={({ onClick, disabled }) => <EBulkButton onClick={onClick} disabled={disabled}>Export selected</EBulkButton>} />
      </EBulkBar>

      <JobDialog open={dialog === "assign"} title="Assign cleaner" busy={busy} onClose={() => setDialog(null)}>
        <div className="space-y-4">
          <select aria-label="Cleaner" value={cleanerId} onChange={(event) => setCleanerId(event.target.value)} className={FIELD}>
            <option value="">Choose cleaner…</option>
            {cleaners.map((cleaner) => <option key={cleaner.id} value={cleaner.id}>{cleaner.name || cleaner.email}</option>)}
          </select>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Assigns this cleaner to the {count} selected jobs; unassigned jobs move to Assigned.</p>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" onClick={() => setDialog(null)} disabled={busy}>Cancel</EButton>
            <EButton onClick={() => void bulkAssign()} disabled={busy || !cleanerId}>{busy ? "Applying…" : "Apply assignment"}</EButton>
          </div>
        </div>
      </JobDialog>

      <JobDialog open={dialog === "qa"} title="Assign QA inspections" busy={busy} onClose={() => setDialog(null)}>
        <div className="space-y-4">
          <select aria-label="Inspector" value={inspectorId} onChange={(event) => setInspectorId(event.target.value)} className={FIELD}>
            <option value="">Choose inspector…</option>
            {inspectors.map((inspector) => <option key={inspector.id} value={inspector.id}>{inspector.name || inspector.email}</option>)}
          </select>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Creates a QA inspection for each of the {count} selected jobs, assigned to this inspector.</p>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" onClick={() => setDialog(null)} disabled={busy}>Cancel</EButton>
            <EButton onClick={() => void bulkQa()} disabled={busy || !inspectorId}>{busy ? "Assigning…" : "Assign QA"}</EButton>
          </div>
        </div>
      </JobDialog>

      <BulkRescheduleDialog open={dialog === "reschedule"} jobIds={selectedIds} onClose={() => setDialog(null)} onFinished={(notMoved) => onDone(notMoved)} />
      <BulkRemindDialog open={dialog === "remind"} jobIds={selectedIds} onClose={() => setDialog(null)} onFinished={(notReminded) => onDone(notReminded)} />
    </>
  );
}
