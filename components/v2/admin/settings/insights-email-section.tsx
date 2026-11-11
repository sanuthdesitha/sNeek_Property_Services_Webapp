"use client";

/**
 * Monthly Insights email: on/off (off by default), recipients picked from the
 * people allowed to receive it (no free-text addresses), day and hour in the
 * organisation timezone, which sections, a "Send me this month's so far" test
 * to the signed-in administrator only, and the last months' send log.
 *
 * GET/PUT /api/admin/settings/insights-email, POST …/test (ADMIN only).
 * Loads are cancelled when the section unmounts; fields are frozen while a
 * save runs and a failed save keeps the draft.
 */
import { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { EAlert, EButton, ECard } from "@/components/v2/ui/primitives";
import {
  INSIGHTS_EMAIL_MAX_DAY,
  INSIGHTS_EMAIL_SECTIONS,
  INSIGHTS_EMAIL_SECTION_LABEL,
  type InsightsEmailSection,
  type InsightsEmailSettings,
} from "@/lib/insights/monthly-email-settings";
import { EField, ESaveStatus, ESectionHeading, ESelectNative, EToggle, useSaveStatus } from "./estate-form";

type Eligible = { id: string; name: string | null; email: string | null; role: string; finance: boolean };
type LogEntry = { month: string; value: unknown; updatedAt: string };
type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; eligible: Eligible[]; log: LogEntry[] };
type Outcome = { userId: string; transport: string; path: string; state: string; errorCode?: string | null };

const STATE_WORDS: Record<string, string> = {
  queued: "queued (not yet delivered)",
  provider_accepted: "accepted by the email provider (not proof of delivery)",
  already_requested: "already sent for this event",
  switched_off: "not sent: email is switched off for this type",
  skipped: "not sent",
  failed: "failed",
  uncertain: "outcome unknown",
};

function describeOutcome(outcome: Outcome): string {
  const words = STATE_WORDS[outcome.state] ?? outcome.state;
  return `${words}${outcome.path === "direct" ? " (direct send: the pipeline's email transport is off)" : ""}${outcome.errorCode ? ` [${outcome.errorCode}]` : ""}`;
}

function logLine(entry: LogEntry): string {
  const value = (entry.value ?? {}) as { state?: string; outcomes?: Outcome[]; error?: string; skippedRecipients?: unknown[] };
  const outcomes = Array.isArray(value.outcomes) ? value.outcomes : [];
  const taken = outcomes.filter((outcome) => ["queued", "provider_accepted", "already_requested"].includes(outcome.state)).length;
  const skipped = Array.isArray(value.skippedRecipients) ? value.skippedRecipients.length : 0;
  if (value.state === "sending") return `${entry.month}: started but not finished (it will not be sent again automatically).`;
  if (value.state === "failed") return `${entry.month}: failed${value.error ? `: ${value.error}` : ""}.`;
  return `${entry.month}: ${taken} of ${outcomes.length} taken by the transport${skipped ? `, ${skipped} recipient${skipped === 1 ? "" : "s"} no longer eligible` : ""}.`;
}

export function InsightsEmailSection() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [draft, setDraft] = useState<InsightsEmailSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const { status, flash } = useSaveStatus();

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/admin/settings/insights-email", { signal: controller.signal, cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!res.ok) throw new Error(body.error ?? "Could not load the monthly email settings.");
        setDraft(body.settings as InsightsEmailSettings);
        setLoad({ status: "ready", eligible: body.eligible ?? [], log: body.log ?? [] });
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load the monthly email settings." });
      }
    })();
    return () => controller.abort();
  }, []);

  function patch(next: Partial<InsightsEmailSettings>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
  }

  function toggleRecipient(id: string) {
    if (!draft) return;
    patch({ recipientIds: draft.recipientIds.includes(id) ? draft.recipientIds.filter((value) => value !== id) : [...draft.recipientIds, id] });
  }

  function toggleSection(section: InsightsEmailSection) {
    if (!draft) return;
    patch({ sections: draft.sections.includes(section) ? draft.sections.filter((value) => value !== section) : [...draft.sections, section] });
  }

  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/insights-email", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash("error", body.error ?? "Could not save. Your changes are still here.");
        return;
      }
      setDraft(body.settings as InsightsEmailSettings);
      flash("saved", "Monthly email settings saved");
    } catch {
      flash("error", "Could not save. Your changes are still here.");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/settings/insights-email/test", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setTestResult(body.error ?? "The test could not be sent.");
      else {
        const outcomes = (body.outcomes ?? []) as Outcome[];
        setTestResult(outcomes.length ? `Test to you: ${outcomes.map(describeOutcome).join("; ")}.` : "Nothing was sent.");
      }
    } catch {
      setTestResult("The test could not be sent. Check the connection and try again.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <ESectionHeading
        eyebrow="Notifications"
        title="Monthly Insights email"
        description="Last month's Business summary from Insights, emailed on the day and hour you choose (organisation timezone). Off until you switch it on. Recipients without finance access get it without money figures."
      />
      {load.status === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : null}
      {load.status === "error" ? <EAlert tone="danger" title="Could not load">{load.message}</EAlert> : null}
      {load.status === "ready" && draft ? (
        <>
          <ECard className="space-y-5 p-6">
            <EToggle
              checked={draft.enabled}
              disabled={saving}
              onChange={(enabled) => patch({ enabled })}
              label="Send the monthly email"
              description={draft.enabled ? "On: it goes once a month to the people ticked below." : "Off: nothing is sent."}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <EField label="Day of the month" hint={`1 to ${INSIGHTS_EMAIL_MAX_DAY}, so every month has it.`}>
                <ESelectNative value={draft.dayOfMonth} disabled={saving} onChange={(event) => patch({ dayOfMonth: Number(event.target.value) })}>
                  {Array.from({ length: INSIGHTS_EMAIL_MAX_DAY }, (_, index) => index + 1).map((day) => <option key={day} value={day}>{day}</option>)}
                </ESelectNative>
              </EField>
              <EField label="Hour">
                <ESelectNative value={draft.hour} disabled={saving} onChange={(event) => patch({ hour: Number(event.target.value) })}>
                  {Array.from({ length: 24 }, (_, hour) => hour).map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}
                </ESelectNative>
              </EField>
            </div>
            <fieldset className="space-y-2" disabled={saving}>
              <legend className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-text-secondary))]">Recipients</legend>
              {load.eligible.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No one can receive it yet.</p> : null}
              {load.eligible.map((person) => (
                <label key={person.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2 text-[0.875rem]">
                  <input type="checkbox" checked={draft.recipientIds.includes(person.id)} onChange={() => toggleRecipient(person.id)} />
                  <span className="min-w-0 flex-1 truncate">{person.name ?? person.email ?? "Account"} <span className="text-[hsl(var(--e-muted-foreground))]">· {person.role === "ADMIN" ? "Administrator" : "Operations manager"}{person.finance ? "" : " · no money figures"}</span></span>
                </label>
              ))}
            </fieldset>
            <fieldset className="space-y-2" disabled={saving}>
              <legend className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-text-secondary))]">Sections</legend>
              {INSIGHTS_EMAIL_SECTIONS.map((section) => (
                <label key={section} className="flex min-h-11 cursor-pointer items-center gap-3 text-[0.875rem]">
                  <input type="checkbox" checked={draft.sections.includes(section)} onChange={() => toggleSection(section)} />
                  {INSIGHTS_EMAIL_SECTION_LABEL[section]}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-wrap items-center gap-3">
              <EButton variant="gold" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</EButton>
              <EButton variant="outline" onClick={sendTest} disabled={testing}>
                <Send className="h-4 w-4" /> {testing ? "Sending…" : "Send me this month's so far"}
              </EButton>
              <ESaveStatus status={status} />
            </div>
            {testResult ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{testResult}</p> : null}
          </ECard>
          <ECard className="p-6">
            <h3 className="text-[1rem] font-semibold">Recent sends</h3>
            {load.log.length === 0 ? (
              <p className="mt-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Not sent yet.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                {load.log.map((entry) => <li key={entry.month}>{logLine(entry)}</li>)}
              </ul>
            )}
            <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-text-faint))]">Each email also appears in Notifications → Delivery log. Accepted by the provider is not the same as delivered.</p>
          </ECard>
        </>
      ) : null}
    </div>
  );
}
