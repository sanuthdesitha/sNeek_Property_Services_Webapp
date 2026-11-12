"use client";

/**
 * Bulk actions for selected needs: Acknowledge, Mark ordered, Close. One
 * request to POST /api/inventory/urgent-stock/bulk; each need goes through the
 * single transition service and its policy and is answered on its own (a need
 * at another stage is refused with the policy's reason). One reason covers the
 * selection, as the service requires a reason for every action. "Add to one
 * shopping run" (Wave F) opens the shared add-to-run dialog for the selection.
 * Close (an office resolution) is offered to administrators and to operations
 * managers with the inventory pack at manage (`canResolve`, from the server).
 */
import { useRef, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { EField, EModal, ETextarea } from "@/components/v2/admin/estate-kit";
import type { UrgentNeedListRow } from "@/lib/inventory/urgent-stock-list";
import type { UrgentBulkAction } from "@/lib/inventory/urgent-stock-actions";
import { newRequestId } from "./urgent-api";
import { AddToRunDialog } from "./add-to-run-dialog";

type Result = { id: string; outcome: "done" | "refused"; message: string };
type RunState = { status: "idle" } | { status: "running" } | { status: "finished"; results: Result[] } | { status: "failed"; message: string };

const COPY: Record<UrgentBulkAction, { title: string; reason: string; body: string }> = {
  acknowledge: { title: "Acknowledge", reason: "Acknowledged by the office.", body: "Records Acknowledged for each selected need that is at Reported." },
  "mark-ordered": { title: "Mark ordered", reason: "Marked ordered by the office.", body: "Records Ordered for each selected need that is at Acknowledged. This does not place an order." },
  close: { title: "Close", reason: "", body: "Resolves each selected open need for the office, with your reason. Use it when the need no longer applies." },
};

const MAX = 50;

export function UrgentBulk({ selectedRows, canResolve, onClear, onFinished, onRunningChange }: { selectedRows: UrgentNeedListRow[]; canResolve: boolean; onClear: () => void; onFinished: (results: Result[]) => void; onRunningChange: (running: boolean) => void }) {
  const [action, setAction] = useState<UrgentBulkAction | null>(null);
  const [addingToRun, setAddingToRun] = useState(false);
  const [reason, setReason] = useState("");
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const bulkRequest = useRef<{ key: string; id: string } | null>(null);
  const names = new Map(selectedRows.map((row) => [row.id, `${row.itemName} · ${row.propertyName}`]));
  const running = run.status === "running";
  const tooMany = selectedRows.length > MAX;
  const properties = new Set(selectedRows.map((row) => row.propertyName));

  function open(next: UrgentBulkAction) {
    setAction(next);
    setReason(COPY[next].reason);
    setRun({ status: "idle" });
  }

  async function confirm() {
    if (!action) return;
    const needs = selectedRows.map((row) => ({ id: row.id, expectedVersion: row.version }));
    const key = JSON.stringify({ action, reason, needs });
    // The same selection and reason keep one request id until it succeeds.
    if (bulkRequest.current?.key !== key) bulkRequest.current = { key, id: newRequestId() };
    setRun({ status: "running" });
    onRunningChange(true);
    try {
      const response = await fetch("/api/inventory/urgent-stock/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, bulkRequestId: bulkRequest.current.id, reason, needs }),
      });
      const body = (await response.json().catch(() => null)) as { results?: Result[]; error?: string } | null;
      if (!response.ok || !Array.isArray(body?.results)) throw new Error(body?.error ?? `The bulk action failed (${response.status}).`);
      bulkRequest.current = null;
      setRun({ status: "finished", results: body.results });
      onFinished(body.results);
    } catch (error) {
      setRun({ status: "failed", message: error instanceof Error ? error.message : "The bulk action failed." });
    } finally {
      onRunningChange(false);
    }
  }

  return (
    <>
      <EBulkBar
        count={selectedRows.length}
        noun={{ one: "need", many: "needs" }}
        summary={properties.size === 1 ? Array.from(properties)[0] : properties.size > 1 ? `${properties.size} properties` : undefined}
        onClear={onClear}
        busy={running}
        note={tooMany ? `At most ${MAX} at a time.` : "Selection covers this page of the current list."}
      >
        <EBulkButton disabled={tooMany} onClick={() => open("acknowledge")}>Acknowledge</EBulkButton>
        <EBulkButton disabled={tooMany} onClick={() => setAddingToRun(true)}>Add to one shopping run</EBulkButton>
        <EBulkButton disabled={tooMany} onClick={() => open("mark-ordered")}>Mark ordered</EBulkButton>
        {canResolve ? <EBulkButton disabled={tooMany} onClick={() => open("close")}>Close</EBulkButton> : null}
      </EBulkBar>
      {addingToRun ? <AddToRunDialog needs={selectedRows} onClose={() => setAddingToRun(false)} onDone={(results) => onFinished(results.map((result) => ({ id: result.id, outcome: result.outcome === "refused" ? "refused" : "done", message: result.message })))} /> : null}
      <EModal open={action !== null} onClose={() => (running ? undefined : setAction(null))} eyebrow="Urgent needs" title={action ? COPY[action].title : ""}>
        {action ? (
          <div className="space-y-4">
            <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{COPY[action].body}</p>
            <p className="text-[0.8125rem]">{selectedRows.length} selected.</p>
            {run.status !== "finished" ? (
              <fieldset disabled={running}>
                <EField label="Reason"><ETextarea required maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></EField>
              </fieldset>
            ) : null}
            {run.status === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{run.message}</p> : null}
            {run.status === "finished" ? (
              <ul aria-label="Results" className="max-h-64 divide-y divide-[hsl(var(--e-border))] overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                {run.results.map((result) => (
                  <li key={result.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[0.8125rem]">
                    <span className="min-w-0 truncate font-[550]">{names.get(result.id) ?? result.id}</span>
                    <span className={result.outcome === "refused" ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-muted-foreground))]"}>{result.outcome === "done" ? "Done" : "Refused"} · {result.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
              {run.status === "finished" ? (
                <EButton size="sm" onClick={() => setAction(null)}>Close</EButton>
              ) : (
                <>
                  <EButton size="sm" variant="outline" disabled={running} onClick={() => setAction(null)}>Cancel</EButton>
                  <EButton size="sm" disabled={running || !reason.trim()} onClick={() => void confirm()}>{running ? "Working…" : COPY[action].title}</EButton>
                </>
              )}
            </div>
          </div>
        ) : null}
      </EModal>
    </>
  );
}
