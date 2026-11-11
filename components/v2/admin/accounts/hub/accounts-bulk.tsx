"use client";

/**
 * Bulk actions for selected people: Resend invite, Change rate (ADMIN), Disable
 * (ADMIN). One request to `POST /api/admin/users/bulk`, which runs each person
 * through the single-person service and its guards and answers per person.
 * This component confirms, sends that one request and shows each answer.
 */
import { useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { EField, EInput, EModal } from "@/components/v2/admin/estate-kit";
import { ACCOUNT_BULK_MAX_IDS, type AccountBulkAction, type AccountBulkResponse } from "@/lib/accounts/bulk-types";
import type { AccountRow } from "@/lib/accounts/list/types";
import { RATE_HELP } from "../person/pay-copy";

const COPY: Record<AccountBulkAction, { title: string; confirm: string; body: string }> = {
  "resend-invite": {
    title: "Resend invites",
    confirm: "Resend",
    body: "Each person who has not verified their email, or is disabled, is sent a new sign-up code. Anyone already verified and active is reported back unchanged. The code service's cooldown applies per person.",
  },
  "change-rate": {
    title: "Change hourly rate",
    confirm: "Change rate",
    body: "Sets the same default hourly rate for each selected person, with the same limits and audit as changing it on one person.",
  },
  disable: {
    title: "Disable accounts",
    confirm: "Disable",
    body: "Each account is disabled and signed out. Your own account and the last active admin are refused.",
  },
};
const OUTCOME_LABEL = { done: "Done", refused: "Refused", unchanged: "No change" } as const;

type RunState = { status: "idle" } | { status: "running" } | { status: "finished"; response: AccountBulkResponse } | { status: "failed"; message: string };

export function AccountsBulk({
  selectedRows,
  canResend,
  isAdmin,
  onClear,
  onFinished,
  onRunningChange,
}: {
  selectedRows: AccountRow[];
  canResend: boolean;
  isAdmin: boolean;
  onClear: () => void;
  onFinished: (response: AccountBulkResponse) => void;
  onRunningChange: (running: boolean) => void;
}) {
  const [pending, setPending] = useState<AccountBulkAction | null>(null);
  const [rate, setRate] = useState("");
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const tooMany = selectedRows.length > ACCOUNT_BULK_MAX_IDS;
  const names = new Map(selectedRows.map((row) => [row.id, row.name ?? row.email]));

  function open(action: AccountBulkAction) {
    setPending(action);
    setRate("");
    setRun({ status: "idle" });
  }

  async function confirm() {
    if (!pending) return;
    const hourlyRate = pending === "change-rate" ? Number(rate) : undefined;
    if (pending === "change-rate" && !(typeof hourlyRate === "number" && Number.isFinite(hourlyRate) && rate.trim() !== "")) {
      setRun({ status: "failed", message: "Enter the new hourly rate as a number." });
      return;
    }
    setRun({ status: "running" });
    onRunningChange(true);
    try {
      const res = await fetch("/api/admin/users/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: pending, ids: selectedRows.map((row) => row.id), ...(hourlyRate !== undefined ? { hourlyRate } : {}) }),
      });
      const body = (await res.json().catch(() => null)) as (AccountBulkResponse & { error?: string }) | null;
      if (!res.ok || !body || !Array.isArray(body.results)) throw new Error(body?.error ?? `The bulk action failed (${res.status}).`);
      setRun({ status: "finished", response: body });
      onFinished(body);
    } catch (error) {
      setRun({ status: "failed", message: error instanceof Error ? error.message : "The bulk action failed." });
    } finally {
      onRunningChange(false);
    }
  }

  if (!canResend && !isAdmin) return null;
  const running = run.status === "running";

  return (
    <>
      <EBulkBar
        count={selectedRows.length}
        noun={{ one: "person", many: "people" }}
        onClear={onClear}
        busy={running}
        note={tooMany ? `At most ${ACCOUNT_BULK_MAX_IDS} at a time.` : "Selection covers this page of the current list."}
      >
        {canResend ? <EBulkButton disabled={tooMany} onClick={() => open("resend-invite")}>Resend invite</EBulkButton> : null}
        {isAdmin ? <EBulkButton disabled={tooMany} onClick={() => open("change-rate")}>Change rate</EBulkButton> : null}
        {isAdmin ? <EBulkButton disabled={tooMany} onClick={() => open("disable")}>Disable</EBulkButton> : null}
      </EBulkBar>

      <EModal open={pending !== null} onClose={() => (running ? undefined : setPending(null))} eyebrow="Accounts" title={pending ? COPY[pending].title : ""}>
        {pending ? (
          <div className="space-y-4">
            <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{COPY[pending].body}</p>
            <p className="text-[0.8125rem]">{selectedRows.length} selected.</p>
            {pending === "change-rate" && run.status !== "finished" ? (
              <EField label="New hourly rate (AUD)" hint={RATE_HELP}>
                <EInput inputMode="decimal" value={rate} disabled={running} onChange={(event) => setRate(event.target.value)} className="e-tnum" />
              </EField>
            ) : null}
            {run.status === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{run.message}</p> : null}
            {run.status === "finished" ? (
              <ul aria-label="Results" className="max-h-64 divide-y divide-[hsl(var(--e-border))] overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                {run.response.results.map((result) => (
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
                <EButton size="sm" variant="primary" onClick={() => setPending(null)}>Close</EButton>
              ) : (
                <>
                  <EButton size="sm" variant="outline" disabled={running} onClick={() => setPending(null)}>Cancel</EButton>
                  <EButton size="sm" variant={pending === "disable" ? "danger" : "primary"} disabled={running} onClick={confirm}>
                    {running ? "Working…" : COPY[pending].confirm}
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
