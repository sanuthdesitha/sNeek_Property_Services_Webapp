"use client";

/**
 * "Tell the client?" inside the move window (board "Everyday dialogs and
 * sheets", 2026-11), instead of a second pop-up after saving.
 *
 * Owner default: ticked when the date or time changes, unticked for a cleaner
 * swap; the person answers every time. Email is the only transport offered.
 * What each answer does (see `useCalendarMove().confirm`):
 *   - date or time change: the reschedule service's schedule-update email is
 *     sent (Yes) or skipped (No) — the same gated send as before;
 *   - the primary cleaner replaced: the prepared "your cleaner changed" email
 *     is sent unedited through the client communications route (Yes), or not
 *     at all (No);
 *   - a first cleaner on an empty job is introduced automatically, as before.
 * The client's email is looked up first (read only, the communications
 * route's preview); with none on file "Yes" is off and says why.
 */
import { useCallback, useEffect, useState } from "react";
import { EChoiceChips } from "@/components/v2/ui/form-dialog-parts";
import type { CalendarJob, CheckMoveResponse } from "@/lib/calendar/types";

export type ClientNoticeScope = {
  /** The reschedule changes the date or the time. */
  schedule: boolean;
  /** The primary cleaner is replaced (the server prepares a note instead of sending it). */
  cleanerSwap: boolean;
  /** A first cleaner goes onto an empty job (introduced automatically, as before). */
  firstCleaner: boolean;
};

export function clientNoticeScope(job: CalendarJob, check: CheckMoveResponse): ClientNoticeScope {
  const assign = check.plan.assign;
  const currentPrimary = job.cleaners.find((cleaner) => cleaner.isPrimary)?.id ?? job.cleaners[0]?.id ?? null;
  return {
    schedule: Boolean(check.plan.reschedule),
    cleanerSwap: Boolean(assign && currentPrimary && assign.primaryUserId && assign.primaryUserId !== currentPrimary),
    firstCleaner: Boolean(assign && job.cleaners.length === 0),
  };
}

/** Owner default (2026-11): yes for date or time changes, no for cleaner swaps. */
export function defaultTellClient(scope: ClientNoticeScope): boolean {
  return scope.schedule;
}

type Recipients = { status: "loading" } | { status: "ready"; recipients: string[]; reason: string | null } | { status: "unknown" };

type ClientNoticeProps = {
  job: CalendarJob;
  scope: ClientNoticeScope;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
};

export function ClientNoticeChoice({ job, scope, value, onChange, disabled }: ClientNoticeProps) {
  const [recipients, setRecipients] = useState<Recipients>({ status: "loading" });
  const asked = scope.schedule || scope.cleanerSwap;
  const stage = scope.schedule ? "SCHEDULE_UPDATED" : "CLEANER_REASSIGNED";

  useEffect(() => {
    if (!asked || !job.clientId) {
      setRecipients(job.clientId ? { status: "unknown" } : { status: "ready", recipients: [], reason: "No client is linked to this job." });
      return;
    }
    const controller = new AbortController();
    setRecipients({ status: "loading" });
    fetch(`/api/admin/clients/${encodeURIComponent(job.clientId)}/communications/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "preview", stage, jobId: job.id }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { recipients?: unknown; reason?: unknown } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body || !Array.isArray(body.recipients)) {
          setRecipients({ status: "unknown" });
          return;
        }
        setRecipients({ status: "ready", recipients: body.recipients.map(String), reason: typeof body.reason === "string" ? body.reason : null });
      })
      .catch(() => {
        if (!controller.signal.aborted) setRecipients({ status: "unknown" });
      });
    return () => controller.abort();
  }, [asked, job.clientId, job.id, stage]);

  const noEmail = recipients.status === "ready" && recipients.recipients.length === 0;
  // With nobody to email, the answer is No and says why.
  useEffect(() => {
    if (noEmail && value) onChange(false);
  }, [noEmail, value, onChange]);

  if (!asked) {
    return scope.firstCleaner ? (
      <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">The client is introduced to their first cleaner automatically, as before.</p>
    ) : null;
  }

  const who = job.clientName ?? "the client";
  const hint = recipients.status === "loading"
    ? "Checking the client's email…"
    : noEmail
      ? `${recipients.status === "ready" && recipients.reason ? recipients.reason : "No client email on file."} "Yes" is off.`
      : recipients.status === "unknown"
        ? "The client's email could not be checked. Yes sends only if one is on file."
        : `Email only, to ${recipients.status === "ready" ? recipients.recipients.join(", ") : who}.${scope.firstCleaner ? " A first cleaner is introduced automatically." : ""}`;

  return (
    <EChoiceChips
      label="Tell the client?"
      name={`tell-client-${job.id}`}
      value={value ? "yes" : "no"}
      onChange={(next) => onChange(next === "yes")}
      disabled={disabled}
      phoneSegmented
      hint={hint}
      options={[
        { value: "yes", label: `Yes, email ${who}`, phoneLabel: "Email them", disabled: noEmail },
        { value: "no", label: "No", phoneLabel: "Don't tell" },
      ]}
    />
  );
}

/**
 * The answer for one checked move: the owner default until the person picks,
 * reset whenever a different check (another plan) arrives.
 */
export function useTellClient(job: CalendarJob, check: CheckMoveResponse | null) {
  const scope = check ? clientNoticeScope(job, check) : null;
  const key = check ? `${check.jobId}:${JSON.stringify(check.plan)}` : "";
  const [picked, setPicked] = useState<{ key: string; value: boolean } | null>(null);
  const value = picked && picked.key === key ? picked.value : scope ? defaultTellClient(scope) : false;
  const setValue = useCallback((next: boolean) => setPicked({ key, value: next }), [key]);
  const asked = Boolean(scope && (scope.schedule || scope.cleanerSwap));
  /** What `confirm` receives: the answer when one was asked, else undefined (nothing to tell). */
  const answer = asked ? value : undefined;
  /** The window says something about the client (the choice, or the automatic first-cleaner note). */
  const shown = Boolean(scope && (asked || scope.firstCleaner));
  return { scope, value, setValue, asked, answer, shown };
}
