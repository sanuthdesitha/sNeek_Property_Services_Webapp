"use client";

/**
 * Bulk actions on selected cases: assign owner, change status (with the
 * required note) and close (with the required note). One request to
 * POST /api/admin/cases/bulk; each row's outcome comes back and refused rows
 * are listed with their reason, never reported as done.
 */
import * as React from "react";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EModal, ESelect } from "@/components/v2/admin/estate-kit";
import { CASE_STATUSES, CASE_STATUS_LABELS } from "@/lib/cases/status";
import type { CaseBulkOutcome } from "@/lib/cases/bulk";
import { runCaseBulkRequest, type CaseBulkRequest } from "./case-api";
import { CaseStatusDialog, type StatusDialogRequest } from "./case-status-dialog";
import { errorMessage, personLabel, type AssigneeOption, type CaseStatus, type CaseSummary, type CaseViewer } from "./case-types";

type Props = {
  selectedIds: string[];
  titles: ReadonlyMap<string, string>;
  assignees: AssigneeOption[];
  viewer: CaseViewer | null;
  onClear: () => void;
  onRowsUpdated: (rows: CaseSummary[]) => void;
  onFinished: () => void;
};

type Pending = { kind: "assign" } | { kind: "status"; request: StatusDialogRequest; action: "status" | "close" } | null;

export function CaseBulk({ selectedIds, titles, assignees, viewer, onClear, onRowsUpdated, onFinished }: Props) {
  const [pending, setPending] = React.useState<Pending>(null);
  const [owner, setOwner] = React.useState("");
  const [status, setStatus] = React.useState<CaseStatus>("INVESTIGATING");
  const [busy, setBusy] = React.useState(false);
  const [refused, setRefused] = React.useState<CaseBulkOutcome[]>([]);
  const [message, setMessage] = React.useState("");

  async function run(request: CaseBulkRequest) {
    setBusy(true);
    setMessage("");
    setRefused([]);
    try {
      const results = await runCaseBulkRequest(request);
      const done = results.filter((row) => row.outcome === "done");
      onRowsUpdated(done.flatMap((row) => (row.outcome === "done" && row.case ? [row.case] : [])));
      setRefused(results.filter((row) => row.outcome === "refused"));
      setMessage(`${done.length} of ${results.length} updated.`);
      setPending(null);
      onFinished();
    } catch (cause) {
      setMessage(errorMessage(cause, "The bulk action failed. Nothing was reported as done."));
    } finally {
      setBusy(false);
    }
  }

  const count = selectedIds.length;
  const subject = `${count} case${count === 1 ? "" : "s"}`;

  return (
    <>
      <EBulkBar count={count} noun={{ one: "case", many: "cases" }} onClear={onClear} busy={busy} note="Selection covers this page only.">
        <EBulkButton onClick={() => setPending({ kind: "assign" })}>Assign owner</EBulkButton>
        <label className="sr-only" htmlFor="case-bulk-status">Status to set</label>
        <select
          id="case-bulk-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as CaseStatus)}
          className="h-8 rounded-[var(--e-radius)] border border-[hsl(var(--e-sidebar-hairline))] bg-transparent px-2 text-[0.75rem] text-[hsl(var(--e-sidebar-active-bg))]"
        >
          {CASE_STATUSES.map((value) => <option key={value} value={value} className="text-black">{CASE_STATUS_LABELS[value]}</option>)}
        </select>
        <EBulkButton onClick={() => setPending({ kind: "status", action: "status", request: { subject, nextStatus: status } })}>Change status</EBulkButton>
        <EBulkButton onClick={() => setPending({ kind: "status", action: "close", request: { subject, nextStatus: "CLOSED" } })}>Close</EBulkButton>
      </EBulkBar>
      {message ? (
        <div role="status" className="space-y-1 text-[0.8125rem]">
          <p>{message}</p>
          {refused.length > 0 ? (
            <ul className="list-disc pl-5 text-[hsl(var(--e-danger))]">
              {refused.map((row) => (
                <li key={row.id}>{titles.get(row.id) ?? row.id}: {row.outcome === "refused" ? row.reason : ""}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <EModal open={pending?.kind === "assign"} onClose={() => setPending(null)} title="Assign owner" eyebrow={subject}>
        <fieldset disabled={busy} className="space-y-4">
          <EField label="Owner">
            <ESelect value={owner} onChange={(event) => setOwner(event.target.value)}>
              <option value="">Unowned (clear owner)</option>
              {assignees.map((person) => <option key={person.id} value={person.id}>{person.id === viewer?.id ? "You" : personLabel(person)}</option>)}
            </ESelect>
          </EField>
          <div className="flex justify-end gap-2">
            <EButton size="sm" variant="outline" onClick={() => setPending(null)}>Cancel</EButton>
            <EButton size="sm" onClick={() => void run({ action: "assign", ids: selectedIds, assignedToUserId: owner || null })}>{busy ? "Assigning…" : "Assign"}</EButton>
          </div>
        </fieldset>
      </EModal>
      <CaseStatusDialog
        request={pending?.kind === "status" ? pending.request : null}
        saving={busy}
        onCancel={() => setPending(null)}
        onConfirm={(note) => {
          if (pending?.kind !== "status") return;
          void run(pending.action === "close"
            ? { action: "close", ids: selectedIds, note }
            : { action: "status", ids: selectedIds, status: pending.request.nextStatus, note });
        }}
      />
    </>
  );
}
