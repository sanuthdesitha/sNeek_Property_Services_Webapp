"use client";

/**
 * People › Clients bulk bar as drawn: Send update, Send portal invite, Export
 * selected, Mark inactive. Send update and Mark inactive run through
 * POST /api/admin/clients/bulk (one outcome per client, refused never shown as
 * done). A portal invite resets that client's portal password, so it stays one
 * client at a time on the client page. Fields freeze while a run is in
 * flight; a failed run keeps the draft.
 */
import { useState } from "react";
import Link from "next/link";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ETextarea } from "@/components/v2/admin/estate-kit";
import { CLIENT_BULK_MAX_IDS, type ClientBulkAction, type ClientBulkResponse } from "@/lib/people/clients/bulk-types";
import type { ClientDirectoryRow } from "@/lib/people/clients/types";
import { OwnPinFields, useOwnPinPrompt } from "@/components/v2/shared/own-pin-fields";

const OUTCOME_LABEL = { done: "Done", refused: "Refused", unchanged: "No change" } as const;

type RunState = { status: "idle" } | { status: "running" } | { status: "finished"; response: ClientBulkResponse } | { status: "failed"; message: string };

export function ClientsBulk({
  selectedRows,
  exportHref,
  onClear,
  onFinished,
  onRunningChange,
}: {
  selectedRows: ClientDirectoryRow[];
  exportHref: string;
  onClear: () => void;
  onFinished: (response: ClientBulkResponse) => void;
  onRunningChange: (running: boolean) => void;
}) {
  const [pending, setPending] = useState<ClientBulkAction | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const ownPin = useOwnPinPrompt(pending === "mark-inactive");
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const tooMany = selectedRows.length > CLIENT_BULK_MAX_IDS;
  const names = new Map(selectedRows.map((row) => [row.id, row.name]));
  const running = run.status === "running";
  const single = selectedRows.length === 1 ? selectedRows[0] : null;

  function open(action: ClientBulkAction) {
    setPending(action);
    ownPin.reset();
    setRun({ status: "idle" });
  }

  async function confirm() {
    if (!pending) return;
    setRun({ status: "running" });
    onRunningChange(true);
    try {
      const payload =
        pending === "send-update"
          ? { action: pending, ids: selectedRows.map((row) => row.id), subject: subject.trim(), message: message.trim() }
          : { action: pending, ids: selectedRows.map((row) => row.id), security: ownPin.credentials ?? undefined };
      const res = await fetch("/api/admin/clients/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await res.json().catch(() => null)) as (ClientBulkResponse & { error?: string }) | null;
      if (!res.ok || !body || !Array.isArray(body.results)) throw new Error(body?.error ?? `The bulk action failed (${res.status}).`);
      setRun({ status: "finished", response: body });
      if (pending === "send-update") {
        setSubject("");
        setMessage("");
      }
      onFinished(body);
    } catch (error) {
      // The draft (subject, message) is kept for a retry.
      setRun({ status: "failed", message: error instanceof Error ? error.message : "The bulk action failed." });
    } finally {
      onRunningChange(false);
    }
  }

  const canConfirm = pending === "send-update" ? subject.trim() !== "" && message.trim() !== "" : ownPin.credentials !== null;

  return (
    <>
      <EBulkBar count={selectedRows.length} noun={{ one: "client", many: "clients" }} onClear={onClear} busy={running} note={tooMany ? `At most ${CLIENT_BULK_MAX_IDS} at a time.` : "Selection covers this page of the current list."}>
        <EBulkButton disabled={tooMany} onClick={() => open("send-update")}>Send update</EBulkButton>
        {single ? (
          <Link className="inline-flex min-h-8 items-center rounded px-2 text-[0.8125rem] underline" href={`/v2/admin/clients/${single.id}?tab=portal`}>Send portal invite</Link>
        ) : (
          <EBulkButton disabled title="A portal invite resets that client's portal password, so it is sent one client at a time.">Send portal invite</EBulkButton>
        )}
        <a className="inline-flex min-h-8 items-center rounded px-2 text-[0.8125rem] underline" href={exportHref} download>Export selected</a>
        <EBulkButton disabled={tooMany} onClick={() => open("mark-inactive")}>Mark inactive</EBulkButton>
      </EBulkBar>

      <EModal open={pending !== null} onClose={() => (running ? undefined : setPending(null))} eyebrow="People" title={pending === "send-update" ? "Send update" : "Mark clients inactive"}>
        {pending ? (
          <div className="space-y-4">
            <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
              {pending === "send-update"
                ? "Each selected client gets this message by email, through the same client update path as on the client page. Clients with no email on file are reported back."
                : "Each selected client is marked inactive, exactly as Delete client does (their records, invoices and history stay). Enter your PIN."}
            </p>
            <p className="text-[0.8125rem]">{selectedRows.length} selected.</p>
            {pending === "send-update" && run.status !== "finished" ? (
              <>
                <EField label="Subject"><EInput value={subject} disabled={running} maxLength={200} onChange={(event) => setSubject(event.target.value)} /></EField>
                <EField label="Message"><ETextarea value={message} disabled={running} rows={5} maxLength={5000} onChange={(event) => setMessage(event.target.value)} /></EField>
              </>
            ) : null}
            {pending === "mark-inactive" && run.status !== "finished" ? (
              <OwnPinFields {...ownPin.fieldProps} disabled={running} />
            ) : null}
            {run.status === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{run.message}</p> : null}
            {run.status === "finished" ? (
              <ul aria-label="Results" className="max-h-64 divide-y divide-[hsl(var(--e-border))] overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                {run.response.results.map((result) => (
                  <li key={result.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[0.8125rem]">
                    <span className="min-w-0 truncate font-[550]">{names.get(result.id) ?? result.id}</span>
                    <span className={result.outcome === "refused" ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-muted-foreground))]"}>{OUTCOME_LABEL[result.outcome]} · {result.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
              {run.status === "finished" ? (
                <EButton size="sm" variant="primary" onClick={() => setPending(null)}>Close</EButton>
              ) : (
                <>
                  <EButton size="sm" variant="outline" disabled={running} onClick={() => setPending(null)}>Cancel</EButton>
                  <EButton size="sm" variant={pending === "mark-inactive" ? "danger" : "primary"} disabled={running || !canConfirm} onClick={confirm}>
                    {running ? "Working…" : pending === "send-update" ? "Send" : "Mark inactive"}
                  </EButton>
                </>
              )}
            </div>
          </div>
        ) : null}
      </EModal>
    </>
  );
}
