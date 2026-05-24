"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CASE_STATE_ORDER,
  caseStateLabel,
  canTransition,
  validNextStates,
  type CaseState,
} from "@/lib/cases/lifecycle-fsm";

export type CaseTransitionRow = {
  id: string;
  fromState: CaseState | null;
  toState: CaseState;
  reason: string | null;
  occurredAt: string;
  actor: { id: string; name: string | null; email: string; role: string } | null;
};

interface Props {
  caseId: string;
  state: CaseState;
  transitions: CaseTransitionRow[];
  onTransitioned?: (next: unknown) => void;
}

function actorLabel(actor: CaseTransitionRow["actor"]) {
  if (!actor) return "System";
  return actor.name?.trim() || actor.email;
}

function stateVariant(state: CaseState) {
  switch (state) {
    case "RESOLVED":
    case "CLOSED":
      return "success" as const;
    case "CANCELLED":
      return "danger" as const;
    case "AWAITING_CLIENT":
      return "warning" as const;
    case "IN_PROGRESS":
    case "ASSIGNED":
      return "info" as const;
    case "TRIAGE":
      return "primary" as const;
    default:
      return "neutral" as const;
  }
}

function formatDateTime(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString("en-AU");
}

function StateRibbon({ current }: { current: CaseState }) {
  const idx = CASE_STATE_ORDER.findIndex((s) => s === current);
  // CANCELLED is off the main rail
  if (current === "CANCELLED") {
    return (
      <div className="flex items-center gap-2 text-xs">
        <StatusPill variant="danger">Cancelled</StatusPill>
        <span className="text-muted-foreground">Case no longer active.</span>
      </div>
    );
  }
  return (
    <ol className="flex items-center gap-1 overflow-x-auto pb-2 text-xs">
      {CASE_STATE_ORDER.map((s, i) => (
        <li
          key={s}
          className={cn(
            "rounded-md px-2 py-1 whitespace-nowrap",
            i < idx && "bg-success/10 text-success",
            i === idx && "bg-primary text-primary-foreground font-semibold",
            i > idx && "bg-muted text-muted-foreground"
          )}
        >
          {caseStateLabel(s)}
        </li>
      ))}
    </ol>
  );
}

export function CaseLifecyclePanel({ caseId, state, transitions, onTransitioned }: Props) {
  const [next, setNext] = useState<CaseState | "">("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const options = useMemo(() => validNextStates(state), [state]);

  async function submit() {
    if (!next) {
      toast({ title: "Pick a next state", variant: "destructive" });
      return;
    }
    if (!canTransition(state, next)) {
      toast({ title: "Invalid transition", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/cases/${caseId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toState: next, reason: reason.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Could not transition case.");
      toast({ title: `Moved to ${caseStateLabel(next)}` });
      setNext("");
      setReason("");
      onTransitioned?.(body);
    } catch (err: any) {
      toast({
        title: "Transition failed",
        description: err?.message ?? "Could not transition case.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border bg-card/40 p-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Lifecycle</h3>
          <StatusPill variant={stateVariant(state)}>{caseStateLabel(state)}</StatusPill>
        </div>
        <StateRibbon current={state} />
      </div>

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">History</Label>
        {transitions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transitions logged yet.</p>
        ) : (
          <ol className="space-y-2">
            {transitions.map((t) => (
              <li
                key={t.id}
                className="rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {t.fromState ? (
                    <>
                      <StatusPill variant={stateVariant(t.fromState)}>
                        {caseStateLabel(t.fromState)}
                      </StatusPill>
                      <span className="text-muted-foreground">→</span>
                    </>
                  ) : null}
                  <StatusPill variant={stateVariant(t.toState)}>
                    {caseStateLabel(t.toState)}
                  </StatusPill>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDateTime(t.occurredAt)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  by {actorLabel(t.actor)}
                </div>
                {t.reason ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm">{t.reason}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="space-y-2 rounded-xl border border-dashed p-3">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Move case to
        </Label>
        <div className="flex flex-wrap gap-2">
          <select
            className="h-10 rounded-xl border border-input/80 bg-background/80 px-3 text-sm"
            value={next}
            onChange={(e) => setNext(e.target.value as CaseState | "")}
            disabled={options.length === 0 || saving}
          >
            <option value="">Select next state…</option>
            {options.map((s) => (
              <option key={s} value={s}>
                {caseStateLabel(s)}
              </option>
            ))}
          </select>
          <Button onClick={submit} disabled={!next || saving}>
            {saving ? "Working…" : "Transition"}
          </Button>
        </div>
        {options.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            This case is in a terminal state. No further transitions available.
          </p>
        ) : (
          <Textarea
            rows={2}
            placeholder="Reason / note (optional but recommended)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </div>
    </div>
  );
}
