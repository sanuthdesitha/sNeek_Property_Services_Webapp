"use client";

/**
 * Assistants bulk bar: Resend invite (account email rules: fresh link, the
 * old one stops working; refused rows reported) and Suspend (the existing
 * "disable" bulk action, ADMIN only, as before). Both run through
 * POST /api/admin/users/bulk with one outcome per person.
 */
import { useState } from "react";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { EButton } from "@/components/v2/ui/primitives";
import { EModal } from "@/components/v2/admin/estate-kit";
import type { AccountBulkResponse } from "@/lib/accounts/bulk-types";
import type { AssistantMember } from "@/lib/people/assistants";

type Action = "resend-invite" | "disable";
type RunState = { status: "idle" } | { status: "running" } | { status: "finished"; response: AccountBulkResponse } | { status: "failed"; message: string };
const OUTCOME_LABEL = { done: "Done", refused: "Refused", unchanged: "No change" } as const;
const COPY: Record<Action, { title: string; body: string; confirm: string }> = {
  "resend-invite": { title: "Resend invitations", body: "Each assistant who has not accepted gets a fresh invitation link, and the old link stops working. Anyone else is reported back unchanged. One resend per person every 5 minutes.", confirm: "Resend" },
  disable: { title: "Suspend assistants", body: "Each login is switched off and signed out; it stays on its team and can be reactivated.", confirm: "Suspend" },
};

export function AssistantsBulk({ selected, canResend, canSuspend, onClear, onFinished, onRunningChange }: { selected: AssistantMember[]; canResend: boolean; canSuspend: boolean; onClear: () => void; onFinished: () => void; onRunningChange: (running: boolean) => void }) {
  const [pending, setPending] = useState<Action | null>(null);
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const names = new Map(selected.map((member) => [member.id, member.name ?? member.email]));
  if (!canResend && !canSuspend) return null;

  async function confirm() {
    if (!pending) return;
    setRun({ status: "running" });
    onRunningChange(true);
    try {
      const res = await fetch("/api/admin/users/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: pending, ids: selected.map((member) => member.id) }) });
      const body = (await res.json().catch(() => null)) as (AccountBulkResponse & { error?: string }) | null;
      if (!res.ok || !body || !Array.isArray(body.results)) throw new Error(body?.error ?? `The bulk action failed (${res.status}).`);
      setRun({ status: "finished", response: body });
    } catch (error) {
      setRun({ status: "failed", message: error instanceof Error ? error.message : "The bulk action failed." });
    } finally {
      onRunningChange(false);
    }
  }

  function close() {
    if (run.status === "running") return;
    if (run.status === "finished") onFinished();
    setPending(null);
    setRun({ status: "idle" });
  }

  return (
    <>
      <EBulkBar count={selected.length} noun={{ one: "assistant", many: "assistants" }} onClear={onClear} busy={run.status === "running"}>
        {canResend ? <EBulkButton onClick={() => setPending("resend-invite")}>Resend invite</EBulkButton> : null}
        {canSuspend ? <EBulkButton onClick={() => setPending("disable")}>Suspend</EBulkButton> : null}
      </EBulkBar>
      <EModal open={pending !== null} onClose={close} eyebrow="Assistants" title={pending ? COPY[pending].title : ""}>
        {pending ? (
          <div className="space-y-4">
            <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{COPY[pending].body}</p>
            <p className="text-[0.8125rem]">{selected.length} selected.</p>
            {run.status === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{run.message}</p> : null}
            {run.status === "finished" ? (
              <ul aria-label="Results" className="max-h-64 divide-y divide-[hsl(var(--e-border))] overflow-y-auto rounded border border-[hsl(var(--e-border))]">
                {run.response.results.map((result) => (
                  <li key={result.id} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-[0.8125rem]">
                    <span className="font-[550]">{names.get(result.id) ?? result.id}</span>
                    <span className={result.outcome === "refused" ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-muted-foreground))]"}>{OUTCOME_LABEL[result.outcome]} · {result.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
              {run.status === "finished" ? (
                <EButton size="sm" variant="primary" onClick={close}>Close</EButton>
              ) : (
                <>
                  <EButton size="sm" variant="outline" disabled={run.status === "running"} onClick={close}>Cancel</EButton>
                  <EButton size="sm" variant={pending === "disable" ? "danger" : "primary"} disabled={run.status === "running"} onClick={confirm}>{run.status === "running" ? "Working…" : COPY[pending].confirm}</EButton>
                </>
              )}
            </div>
          </div>
        ) : null}
      </EModal>
    </>
  );
}
