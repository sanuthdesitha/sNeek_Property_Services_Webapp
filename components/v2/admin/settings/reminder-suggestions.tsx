"use client";

/**
 * "Reminder suggestions" (smart property reminders, slice C, 2026-11-28), on
 * Settings › Property reminder rules. One-off reminders the system proposes
 * from the facts of rules that are off. Approve, Edit then approve, or
 * Dismiss, singly or for the ticked rows; nothing reaches a cleaner until it
 * is approved (it then becomes an office reminder for the next job unless
 * edited). "Always do this" (administrators) switches the rule on after its
 * preview. Everything freezes while a decision saves; an edit draft stays
 * when a save fails.
 */
import * as React from "react";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESwitch, ETextarea } from "@/components/v2/admin/estate-kit";
import { EPill } from "@/components/v2/ui/pill";
import { NEXT_JOBS_MAX, REMINDER_TEXT_MAX } from "@/lib/properties/reminders/model";

type Suggestion = { id: string; rule: string; ruleName: string; propertyId: string; propertyName: string; text: string; why: string; where: string; stillCurrent: boolean; createdAt: string };
type RulePreview = { rule: string; name: string; reminders: number; properties: number; cleaners: number; summary: string };
type Payload = { suggestions: Suggestion[]; previews: RulePreview[]; canAlways: boolean; canDecide: boolean; rulesReadable: boolean };
type Load = { status: "loading" } | { status: "failed"; message: string } | { status: "ready"; data: Payload };
type Outcome = { id: string; outcome: string };
type EditDraft = { text: string; jobsCount: string; mustConfirm: boolean };

const MUTED = "text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]";
const OUTCOME_TEXT: Record<string, string> = {
  APPROVED: "approved",
  DISMISSED: "dismissed",
  ALREADY_DECIDED: "already decided by someone else",
  FACTS_CHANGED: "not approved: the facts no longer hold",
  NOT_FOUND: "not found",
};

function summarise(results: Outcome[]): string {
  const counts = new Map<string, number>();
  for (const result of results) counts.set(result.outcome, (counts.get(result.outcome) ?? 0) + 1);
  return Array.from(counts.entries()).map(([outcome, count]) => `${count} ${OUTCOME_TEXT[outcome] ?? outcome.toLowerCase()}`).join(", ") + ".";
}

async function postDecision(body: unknown): Promise<Outcome[]> {
  const response = await fetch("/api/admin/properties/reminder-suggestions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => null)) as { results?: Outcome[]; error?: string } | null;
  if (!response.ok || !payload?.results) throw new Error(payload?.error ?? "Not saved.");
  return payload.results;
}

function EditForm({ suggestion, busy, onApprove, onCancel }: { suggestion: Suggestion; busy: boolean; onApprove: (draft: EditDraft) => Promise<boolean>; onCancel: () => void }) {
  const [draft, setDraft] = React.useState<EditDraft>({ text: suggestion.text, jobsCount: "1", mustConfirm: false });
  const [error, setError] = React.useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.text.trim()) return setError("Write the reminder.");
    if (!/^\d{1,2}$/.test(draft.jobsCount) || Number(draft.jobsCount) < 1 || Number(draft.jobsCount) > NEXT_JOBS_MAX) return setError(`Jobs: 1 to ${NEXT_JOBS_MAX}.`);
    setError(null);
    const saved = await onApprove(draft);
    if (!saved) setError("Not saved. Your edit is still here.");
  }
  return (
    <form onSubmit={submit} className="mt-2 space-y-2">
      <fieldset disabled={busy} className="space-y-2">
        <EField label="Reminder text">
          <ETextarea value={draft.text} maxLength={REMINDER_TEXT_MAX} onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))} />
        </EField>
        <EField label="For the next jobs" hint="1 = the next job at this property.">
          <EInput inputMode="numeric" maxLength={2} value={draft.jobsCount} onChange={(event) => setDraft((current) => ({ ...current, jobsCount: event.target.value.replace(/\D/g, "") }))} />
        </EField>
        <ESwitch checked={draft.mustConfirm} onCheckedChange={(value) => setDraft((current) => ({ ...current, mustConfirm: value }))} label="Must confirm (the cleaner taps Done)" />
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <EButton type="submit" size="sm">Approve with these changes</EButton>
          <EButton type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</EButton>
        </div>
      </fieldset>
    </form>
  );
}

export function ReminderSuggestions({ refreshKey = 0, onRuleChanged }: { refreshKey?: number; onRuleChanged?: () => void }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [version, setVersion] = React.useState(0);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [editing, setEditing] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/admin/properties/reminder-suggestions", { cache: "no-store", signal: controller.signal });
        const body = (await response.json().catch(() => null)) as (Payload & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.suggestions) return setLoad({ status: "failed", message: body?.error ?? "Could not load the suggestions." });
        setLoad({ status: "ready", data: body });
        setSelected((current) => new Set(Array.from(current).filter((id) => body.suggestions.some((row) => row.id === id))));
      } catch {
        if (!controller.signal.aborted) setLoad({ status: "failed", message: "Could not load the suggestions." });
      }
    })();
    return () => controller.abort();
  }, [version, refreshKey]);

  async function decide(body: { action: "approve" | "dismiss"; ids: string[]; edit?: { text: string; jobsCount: number; mustConfirm: boolean } }): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const results = await postDecision(body);
      setNotice(summarise(results));
      setEditing(null);
      setVersion((value) => value + 1);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Not saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function alwaysDo(preview: RulePreview) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/settings/reminder-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule: preview.rule, enabled: true, seen: { reminders: preview.reminders, properties: preview.properties, cleaners: preview.cleaners } }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "The rule was not switched on.");
        setVersion((value) => value + 1);
        return;
      }
      setNotice(`"${preview.name}" is now an automatic rule.`);
      setVersion((value) => value + 1);
      onRuleChanged?.();
    } catch {
      setError("The rule was not switched on. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  if (load.status === "loading") return <p role="status" className={MUTED}>Loading suggestions…</p>;
  if (load.status === "failed") {
    return (
      <EAlert tone="danger" title="Suggestions could not be loaded">
        <p>{load.message}</p>
        <EButton type="button" size="sm" variant="outline" className="mt-2" onClick={() => setVersion((value) => value + 1)}>Try again</EButton>
      </EAlert>
    );
  }
  const { data } = load;
  const groups = data.previews.filter((preview) => data.suggestions.some((row) => row.rule === preview.rule));
  const selectedIds = Array.from(selected);

  return (
    <section aria-labelledby="reminder-suggestions-title" className="space-y-3">
      <div>
        <h2 id="reminder-suggestions-title" className="text-[1rem] font-[650]">Reminder suggestions</h2>
        <p className={MUTED}>One-off reminders from the facts of rules that are off. Nothing reaches a cleaner until it is approved; an approved one is shown on the next job at that property unless you edit it. A dismissed suggestion is not proposed again for the same facts.</p>
      </div>
      {!data.canDecide ? <p className={MUTED}>Stop testing as another person to decide suggestions.</p> : null}
      {notice ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-success))]">{notice}</p> : null}
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      {data.suggestions.length === 0 ? (
        <p className={MUTED}>No suggestions waiting.</p>
      ) : (
        <>
          {data.canDecide ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className={MUTED}>{selectedIds.length} ticked</span>
              <EButton type="button" size="sm" disabled={busy || selectedIds.length === 0} onClick={() => void decide({ action: "approve", ids: selectedIds })}>Approve ticked</EButton>
              <EButton type="button" size="sm" variant="outline" disabled={busy || selectedIds.length === 0} onClick={() => void decide({ action: "dismiss", ids: selectedIds })}>Dismiss ticked</EButton>
            </div>
          ) : null}
          {groups.map((preview) => (
            <div key={preview.rule} className="space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="min-w-0 text-[0.875rem] font-[650] [overflow-wrap:anywhere]">{preview.name}</h3>
                {data.canAlways ? (
                  <EButton type="button" size="sm" variant="outline" disabled={busy} onClick={() => void alwaysDo(preview)} aria-label={`Always do this: switch on "${preview.name}" (${preview.summary})`}>
                    Always do this
                  </EButton>
                ) : null}
              </div>
              {data.canAlways ? <p className={MUTED}>Always do this switches the rule on. {preview.summary}.</p> : null}
              <ul className="space-y-2">
                {data.suggestions.filter((row) => row.rule === preview.rule).map((row) => (
                  <li key={row.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5">
                    <div className="flex items-start gap-2">
                      {data.canDecide ? (
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0"
                          aria-label={`Tick: ${row.text}`}
                          disabled={busy}
                          checked={selected.has(row.id)}
                          onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next; })}
                        />
                      ) : null}
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-[0.8125rem] font-[600] [overflow-wrap:anywhere]">{row.text}</p>
                        <p className={`${MUTED} [overflow-wrap:anywhere]`}><span className="font-[550]">{row.propertyName}</span> · {row.where}. <span className="font-[550]">Facts:</span> {row.why}</p>
                        {!row.stillCurrent ? <EPill tone="warn">Facts no longer hold</EPill> : null}
                        {editing === row.id ? (
                          <EditForm
                            suggestion={row}
                            busy={busy}
                            onCancel={() => setEditing(null)}
                            onApprove={(draft) => decide({ action: "approve", ids: [row.id], edit: { text: draft.text.trim(), jobsCount: Number(draft.jobsCount), mustConfirm: draft.mustConfirm } })}
                          />
                        ) : data.canDecide ? (
                          <div className="flex flex-wrap gap-2 pt-1">
                            <EButton type="button" size="sm" disabled={busy || !row.stillCurrent} onClick={() => void decide({ action: "approve", ids: [row.id] })}>Approve</EButton>
                            <EButton type="button" size="sm" variant="outline" disabled={busy || !row.stillCurrent} onClick={() => setEditing(row.id)}>Edit then approve</EButton>
                            <EButton type="button" size="sm" variant="outline" disabled={busy} onClick={() => void decide({ action: "dismiss", ids: [row.id] })}>Dismiss</EButton>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
