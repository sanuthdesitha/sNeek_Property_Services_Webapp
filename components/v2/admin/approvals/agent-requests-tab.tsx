"use client";

/**
 * Approvals › Agent requests (step 6). Changes a connected agent asked for:
 * who asked, the exact change in plain words, how long it has waited, and
 * Approve or Reject. Approving runs the existing service as the signed-in
 * person after the server's live checks (their own access, the entity's
 * current state, the global pause, their PIN where the same action needs
 * one); the server's sentence is shown when it refuses. Below, the decided
 * requests with their outcome.
 *
 * Phones (below 640px): the cards stack, the two sections get the shared
 * sticky section chips, and the decision dialog is the shared bottom sheet.
 */
import * as React from "react";
import { RefreshCw } from "lucide-react";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { ESectionSwitcher } from "@/components/v2/ui/phone-bars";
import { EToneCard, type ETone } from "@/components/v2/ui/tone-band";
import { OwnPinFields, useOwnPinPrompt } from "@/components/v2/shared/own-pin-fields";
import { cn } from "@/lib/utils";
import { waitingLabel } from "@/lib/admin/approvals/rows";
import type { AgentRequestView, AgentRequestsResponse } from "@/lib/agents/action-views";
import type { AgentRequestStatus } from "@/lib/agents/write-scopes";
import { formatInstant } from "./panel/panel-kit";

type Decision = "approve" | "reject";
type PendingDecision = { request: AgentRequestView; decision: Decision };
type DecisionNotice = { tone: "status" | "alert"; text: string };
type LoadState = { data: AgentRequestsResponse | null; loading: boolean; error: string | null };

const HISTORY_TONE: Partial<Record<AgentRequestStatus, ETone>> = { FAILED: "problem", APPROVED: "attention" };

function useAgentRequests(): LoadState & { reload: () => Promise<void> } {
  const [state, setState] = React.useState<LoadState>({ data: null, loading: true, error: null });
  const controller = React.useRef<AbortController | null>(null);

  const reload = React.useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState((previous) => ({ ...previous, loading: true }));
    try {
      const response = await fetch("/api/admin/agent-requests", { cache: "no-store", signal: current.signal });
      const body = (await response.json().catch(() => null)) as (AgentRequestsResponse & { error?: string }) | null;
      if (current.signal.aborted) return;
      if (!response.ok || !body || !Array.isArray(body.waiting)) {
        setState((previous) => ({ ...previous, loading: false, error: body?.error ?? "The agent requests could not be loaded." }));
        return;
      }
      setState({ data: body, loading: false, error: null });
    } catch (error) {
      if (current.signal.aborted) return;
      setState((previous) => ({ ...previous, loading: false, error: error instanceof Error && error.name !== "AbortError" ? "The agent requests could not be loaded." : previous.error }));
    }
  }, []);

  React.useEffect(() => {
    void reload();
    return () => controller.current?.abort();
  }, [reload]);

  return { ...state, reload };
}

function Facts({ request }: { request: AgentRequestView }) {
  return (
    <>
      {request.details.length ? (
        <ul className="list-disc space-y-0.5 pl-5 text-[0.8125rem]">
          {request.details.map((line, index) => <li key={index} className="break-words">{line}</li>)}
        </ul>
      ) : null}
      {request.effects.length ? (
        <div className="text-[0.8125rem]">
          <p className="font-[600]">Approving also:</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {request.effects.map((line, index) => <li key={index} className="break-words">{line}</li>)}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function WaitingCard({ request, now, timezone, busy, onDecide }: { request: AgentRequestView; now: number; timezone: string; busy: boolean; onDecide: (decision: Decision) => void }) {
  const waited = waitingLabel(Math.max(0, now - new Date(request.createdAt).getTime()));
  return (
    <EToneCard
      tone="attention"
      data-testid="agent-request"
      header={<span className="block min-w-0 break-words font-[600]">{request.agentName} · {request.toolLabel}</span>}
      pill={`Waiting ${waited}`}
      bodyClassName="space-y-2.5"
    >
      <p className="break-words text-[0.875rem] font-[550]">{request.summary}</p>
      <Facts request={request} />
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        Asked {formatInstant(request.createdAt, timezone, "d MMM HH:mm")} · expires {formatInstant(request.expiresAt, timezone, "d MMM HH:mm")}
        {request.agentStatus !== "ACTIVE" ? " · the agent has been revoked" : ""}
      </p>
      {request.refusal ? <p className="text-[0.8125rem]">You cannot decide this: {request.refusal}</p> : null}
      <div className="flex flex-wrap gap-2">
        <EButton size="sm" className="max-sm:flex-1" disabled={busy || !request.canDecide} onClick={() => onDecide("approve")}>Approve</EButton>
        <EButton size="sm" variant="outline" className="max-sm:flex-1" disabled={busy || !request.canDecide} onClick={() => onDecide("reject")}>Reject</EButton>
      </div>
    </EToneCard>
  );
}

function HistoryCard({ request, timezone }: { request: AgentRequestView; timezone: string }) {
  const tone = HISTORY_TONE[request.status] ?? null;
  return (
    <EToneCard
      tone={tone}
      header={<span className="block min-w-0 break-words font-[600]">{request.agentName} · {request.toolLabel}</span>}
      pill={request.statusLabel}
      bodyClassName="space-y-1.5"
    >
      <p className="break-words text-[0.8125rem]">{request.summary}</p>
      {request.outcome ? <p className="break-words text-[0.8125rem]">Outcome: {request.outcome}</p> : null}
      {request.decisionReason ? <p className="break-words text-[0.8125rem]">Reason: {request.decisionReason}</p> : null}
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        {request.decidedBy ? `Decided by ${request.decidedBy}` : "No decision by a person"}
        {request.decidedAt ? ` · ${formatInstant(request.decidedAt, timezone, "d MMM HH:mm")}` : ""}
      </p>
    </EToneCard>
  );
}

export function AgentRequestsTab({ timezone }: { timezone: string }) {
  const { data, loading, error, reload } = useAgentRequests();
  const [pending, setPending] = React.useState<PendingDecision | null>(null);
  // Typed reasons are kept per request while the dialog is closed or a decision fails.
  const [reasons, setReasons] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [dialogError, setDialogError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<DecisionNotice | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const needsPin = pending?.decision === "approve" && pending.request.needsPin;
  const pin = useOwnPinPrompt(Boolean(needsPin));

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  function open(request: AgentRequestView, decision: Decision) {
    setDialogError(null);
    setPending({ request, decision });
  }

  async function submit() {
    if (!pending) return;
    if (needsPin && !pin.credentials) return;
    setBusy(true);
    setDialogError(null);
    const reason = reasons[pending.request.id]?.trim();
    try {
      const response = await fetch(`/api/admin/agent-requests/${encodeURIComponent(pending.request.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: pending.decision, ...(reason ? { reason } : {}), ...(needsPin && pin.credentials ? { credentials: pin.credentials } : {}) }),
      });
      const body = (await response.json().catch(() => ({}))) as { status?: string; message?: string; error?: string };
      if (!response.ok) {
        pin.reset();
        setDialogError(body.error ?? "The decision was refused.");
        if (response.status === 409) await reload();
        return;
      }
      setNotice({ tone: body.status === "FAILED" ? "alert" : "status", text: body.status === "FAILED" ? `Not applied: ${body.message ?? "no reason was given."}` : body.message ?? "Decided." });
      setReasons((previous) => {
        const next = { ...previous };
        delete next[pending.request.id];
        return next;
      });
      setPending(null);
      await reload();
    } catch {
      setDialogError("The decision could not be sent. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const waiting = data?.waiting ?? [];
  const history = data?.history ?? [];

  return (
    <div className="min-w-0 space-y-5">
      <ESectionSwitcher label="Agent request sections" sections={[{ id: "agent-requests-waiting", label: `Waiting${data ? ` ${waiting.length}` : ""}` }, { id: "agent-requests-decided", label: "Decided" }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 max-w-[60ch] text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Changes a connected agent asked for. Nothing changes until someone who could make the change approves it; approving runs it as you.
        </p>
        <EButton variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
          <RefreshCw aria-hidden className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </EButton>
      </div>

      {data?.paused ? (
        <EAlert tone="warning" title="All agents are paused">
          Waiting requests cannot be approved until agents are resumed in Settings, Access, Agents. You can still reject them.
        </EAlert>
      ) : null}
      {notice ? (
        <div role={notice.tone} className="text-[0.8125rem]">{notice.text}</div>
      ) : null}
      {error && data ? <EAlert tone="warning" title="Showing the last list loaded">{error}</EAlert> : null}

      <section id="agent-requests-waiting" aria-labelledby="agent-requests-waiting-heading" className="min-w-0 space-y-3">
        <h2 id="agent-requests-waiting-heading" className="text-base font-semibold">Waiting{data ? ` (${waiting.length})` : ""}</h2>
        {!data && loading ? <p role="status" className="text-[0.8125rem]">Loading agent requests…</p> : null}
        {!data && !loading && error ? (
          <EAlert tone="danger" title="Agent requests unavailable">
            {error} <button type="button" className="underline" onClick={() => void reload()}>Retry</button>
          </EAlert>
        ) : null}
        {data && waiting.length === 0 ? <p className="text-[0.8125rem]">No agent request is waiting.</p> : null}
        {waiting.map((request) => (
          <WaitingCard key={request.id} request={request} now={now} timezone={timezone} busy={busy} onDecide={(decision) => open(request, decision)} />
        ))}
      </section>

      <section id="agent-requests-decided" aria-labelledby="agent-requests-decided-heading" className="min-w-0 space-y-3">
        <h2 id="agent-requests-decided-heading" className="text-base font-semibold">Decided</h2>
        {data && history.length === 0 ? <p className="text-[0.8125rem]">No decided agent requests yet.</p> : null}
        {history.map((request) => <HistoryCard key={request.id} request={request} timezone={timezone} />)}
      </section>

      <EActionDialog
        open={pending !== null}
        title={pending?.decision === "approve" ? "Approve and apply?" : "Reject this request?"}
        eyebrow={pending ? `${pending.request.agentName} · ${pending.request.toolLabel}` : undefined}
        busy={busy}
        onClose={() => setPending(null)}
        footer={
          <>
            <EButton size="sm" variant="ghost" disabled={busy} onClick={() => setPending(null)}>Cancel</EButton>
            <EButton size="sm" variant={pending?.decision === "reject" ? "outline" : "primary"} disabled={busy || Boolean(needsPin && !pin.credentials)} onClick={() => void submit()}>
              {busy ? "Working…" : pending?.decision === "approve" ? "Approve" : "Reject"}
            </EButton>
          </>
        }
      >
        {pending ? (
          <fieldset disabled={busy} className="min-w-0 space-y-3">
            <p className="break-words text-[0.875rem] font-[550]">{pending.request.summary}</p>
            {pending.decision === "approve" ? (
              <>
                <Facts request={pending.request} />
                <p className="text-[0.8125rem]">The server checks your access and the current state again. If anything changed since the agent asked, nothing is applied and the reason is shown.</p>
                {needsPin ? <OwnPinFields {...pin.fieldProps} disabled={busy} autoFocus /> : null}
              </>
            ) : (
              <label className="block text-[0.8125rem] font-[550]">
                Reason (optional)
                <textarea
                  className="mt-1 block min-h-[88px] w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] p-2.5 text-[16px] sm:text-[0.8125rem]"
                  maxLength={500}
                  value={reasons[pending.request.id] ?? ""}
                  onChange={(event) => setReasons((previous) => ({ ...previous, [pending.request.id]: event.target.value }))}
                />
              </label>
            )}
            {dialogError ? <p role="alert" className="text-[0.8125rem]">{dialogError}</p> : null}
          </fieldset>
        ) : null}
      </EActionDialog>
    </div>
  );
}
