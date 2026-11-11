"use client";

/**
 * Bulk actions for selected items: Move to storage, Mark unclaimed, Donate or
 * dispose. One request to POST /api/admin/lost-found/bulk, which runs each
 * item through the single-item change and answers per item. The note is the
 * same optional note the single action takes.
 */
import { useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { EField, EModal, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { LOST_FOUND_BULK_MAX, type LostFoundBulkAction, type LostFoundBulkResult } from "@/lib/lost-found/bulk-types";
import type { LostFoundListRow } from "@/lib/lost-found/list";

type Dialog = "move-to-storage" | "mark-unclaimed" | "donate-or-dispose";

const COPY: Record<Dialog, { title: string; body: string; confirm: string }> = {
  "move-to-storage": { title: "Move to storage", body: "Each open item moves to In storage. A closed item is refused: reopen it first.", confirm: "Move to storage" },
  "mark-unclaimed": { title: "Mark unclaimed", body: "Records Unclaimed as the final decision for each open item, with your note and your name.", confirm: "Mark unclaimed" },
  "donate-or-dispose": { title: "Donate or dispose", body: "Records the final decision for each open or unclaimed item, with your note and your name.", confirm: "Record decision" },
};

const OUTCOME_LABEL: Record<LostFoundBulkResult["outcome"], string> = { done: "Done", unchanged: "No change", refused: "Refused" };

type RunState = { status: "idle" } | { status: "running" } | { status: "finished"; results: LostFoundBulkResult[] } | { status: "failed"; message: string };

export function LostFoundBulk({ selectedRows, onClear, onFinished, onRunningChange }: { selectedRows: LostFoundListRow[]; onClear: () => void; onFinished: (results: LostFoundBulkResult[]) => void; onRunningChange: (running: boolean) => void }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [decision, setDecision] = useState<"donate" | "dispose">("donate");
  const [note, setNote] = useState("");
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const names = new Map(selectedRows.map((row) => [row.id, row.itemName]));
  const tooMany = selectedRows.length > LOST_FOUND_BULK_MAX;
  const running = run.status === "running";

  function open(next: Dialog) {
    setDialog(next);
    setRun({ status: "idle" });
  }

  async function confirm() {
    if (!dialog) return;
    const action: LostFoundBulkAction = dialog === "donate-or-dispose" ? decision : dialog;
    setRun({ status: "running" });
    onRunningChange(true);
    try {
      const response = await fetch("/api/admin/lost-found/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: selectedRows.map((row) => row.id), note: note.trim() || null }),
      });
      const body = (await response.json().catch(() => null)) as { results?: LostFoundBulkResult[]; error?: string } | null;
      if (!response.ok || !Array.isArray(body?.results)) throw new Error(body?.error ?? `The bulk action failed (${response.status}).`);
      setRun({ status: "finished", results: body.results });
      setNote("");
      onFinished(body.results);
    } catch (error) {
      // The note stays so the office can retry without retyping it.
      setRun({ status: "failed", message: error instanceof Error ? error.message : "The bulk action failed." });
    } finally {
      onRunningChange(false);
    }
  }

  return (
    <>
      <EBulkBar count={selectedRows.length} noun={{ one: "item", many: "items" }} onClear={onClear} busy={running} note={tooMany ? `At most ${LOST_FOUND_BULK_MAX} at a time.` : "Selection covers this page of the current list."}>
        <EBulkButton disabled={tooMany} onClick={() => open("move-to-storage")}>Move to storage</EBulkButton>
        <EBulkButton disabled={tooMany} onClick={() => open("mark-unclaimed")}>Mark unclaimed</EBulkButton>
        <EBulkButton disabled={tooMany} onClick={() => open("donate-or-dispose")}>Donate or dispose</EBulkButton>
      </EBulkBar>

      <EModal open={dialog !== null} onClose={() => (running ? undefined : setDialog(null))} eyebrow="Lost and found" title={dialog ? COPY[dialog].title : ""}>
        {dialog ? (
          <div className="space-y-4">
            <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{COPY[dialog].body}</p>
            <p className="text-[0.8125rem]">{selectedRows.length} selected.</p>
            {run.status !== "finished" ? (
              <fieldset disabled={running} className="space-y-3">
                {dialog === "donate-or-dispose" ? (
                  <EField label="Decision">
                    <ESelect value={decision} onChange={(event) => setDecision(event.target.value as "donate" | "dispose")}>
                      <option value="donate">Donated</option>
                      <option value="dispose">Disposed</option>
                    </ESelect>
                  </EField>
                ) : null}
                <EField label={dialog === "move-to-storage" ? "Note (optional)" : "Resolution note (optional)"}>
                  <ETextarea value={note} maxLength={4000} onChange={(event) => setNote(event.target.value)} placeholder={dialog === "move-to-storage" ? "e.g. Shelf B" : "e.g. held 14 days, donated to Vinnies"} />
                </EField>
              </fieldset>
            ) : null}
            {run.status === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{run.message}</p> : null}
            {run.status === "finished" ? (
              <ul aria-label="Results" className="max-h-64 divide-y divide-[hsl(var(--e-border))] overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                {run.results.map((result) => (
                  <li key={result.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[0.8125rem]">
                    <span className="min-w-0 truncate font-[550]">{names.get(result.id) ?? result.id}</span>
                    <span className={result.outcome === "refused" ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-muted-foreground))]"}>
                      {OUTCOME_LABEL[result.outcome]} · {result.message}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
              {run.status === "finished" ? (
                <EButton size="sm" onClick={() => setDialog(null)}>Close</EButton>
              ) : (
                <>
                  <EButton size="sm" variant="outline" disabled={running} onClick={() => setDialog(null)}>Cancel</EButton>
                  <EButton size="sm" disabled={running} onClick={confirm}>{running ? "Working…" : COPY[dialog].confirm}</EButton>
                </>
              )}
            </div>
          </div>
        ) : null}
      </EModal>
    </>
  );
}
