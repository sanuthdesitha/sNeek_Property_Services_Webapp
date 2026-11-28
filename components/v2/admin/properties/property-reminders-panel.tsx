"use client";

/**
 * Property › Care and planning › Reminders for cleaners (smart property
 * reminders, slice A, 2026-11-28). The office writes short reminders by hand:
 * what, when the cleaner sees it (before start / in a room / before leaving),
 * for whom (every cleaner or one), how long (every job / next N jobs / until
 * a date) and whether the cleaner must confirm it. The list says why each
 * exists and when it ends; Edit and End act on one.
 *
 * Rendered inside the property page's lazy disclosure and keyed by property,
 * so another property starts fresh. Reads are cancelled when superseded and
 * checked after parsing; the form freezes while saving and keeps its draft
 * when a save fails. Cleaners see reminders only while the "Property
 * reminders" pilot is on; the panel says when it is not.
 */
import * as React from "react";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ESwitch, ETextarea } from "@/components/v2/admin/estate-kit";
import { EPill } from "@/components/v2/ui/pill";
import { REMINDER_ROOM_KEYS, REMINDER_ROOM_LABEL, type ReminderRoomKey } from "@/lib/properties/reminders/sections";
import { NEXT_JOBS_MAX, REMINDER_MOMENT_LABEL, REMINDER_TEXT_MAX, type ReminderLifetime, type ReminderMoment } from "@/lib/properties/reminders/model";
import type { OfficeReminderView, PropertyRemindersView, ReminderPilotStatus } from "@/lib/properties/reminders/service";

const MUTED = "text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: PropertyRemindersView };

type Draft = {
  text: string;
  moment: ReminderMoment;
  roomKey: ReminderRoomKey;
  cleanerId: string;
  lifetime: ReminderLifetime;
  jobsCount: string;
  untilDate: string;
  mustConfirm: boolean;
  reason: string;
};

const EMPTY_DRAFT: Draft = { text: "", moment: "BEFORE_START", roomKey: "kitchen", cleanerId: "", lifetime: "EVERY_JOB", jobsCount: "1", untilDate: "", mustConfirm: false, reason: "" };

const PILOT_NOTICE: Record<ReminderPilotStatus, string | null> = {
  ON: null,
  SCOPED_THIS_PROPERTY: null,
  OFF: "The \"Property reminders\" pilot is off: cleaners do not see these reminders. You can still write and edit them.",
  SCOPED_NOT_THIS_PROPERTY: "The \"Property reminders\" pilot is on only for selected people or properties, and this property is not selected: only selected cleaners see these.",
  UNREADABLE: "The pilot setting could not be read, so it counts as off: cleaners do not see these reminders right now.",
};

function draftFrom(view: OfficeReminderView): Draft {
  return {
    text: view.text,
    moment: view.moment,
    roomKey: (REMINDER_ROOM_KEYS as readonly string[]).includes(view.roomKey ?? "") ? (view.roomKey as ReminderRoomKey) : "kitchen",
    cleanerId: view.cleaner?.id ?? "",
    lifetime: view.lifetime,
    jobsCount: String(view.jobsCount ?? 1),
    untilDate: view.untilDate ?? "",
    mustConfirm: view.mustConfirm,
    reason: view.reason ?? "",
  };
}

function payloadFrom(draft: Draft) {
  return {
    text: draft.text.trim(),
    moment: draft.moment,
    roomKey: draft.moment === "ROOM" ? draft.roomKey : null,
    cleanerId: draft.cleanerId || null,
    lifetime: draft.lifetime,
    jobsCount: draft.lifetime === "NEXT_JOBS" ? Number(draft.jobsCount) : null,
    untilDate: draft.lifetime === "UNTIL_DATE" ? draft.untilDate || null : null,
    mustConfirm: draft.mustConfirm,
    reason: draft.reason.trim() || null,
  };
}

function draftProblem(draft: Draft): string | null {
  if (!draft.text.trim()) return "Write the reminder.";
  if (draft.lifetime === "NEXT_JOBS" && !/^\d{1,2}$/.test(draft.jobsCount)) return `Say how many jobs (1 to ${NEXT_JOBS_MAX}).`;
  if (draft.lifetime === "UNTIL_DATE" && !draft.untilDate) return "Choose the last day.";
  return null;
}

async function sendJson(url: string, method: string, payload: unknown): Promise<void> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? "That was not saved.");
}

function whereLabel(view: Pick<OfficeReminderView, "moment" | "roomLabel">): string {
  return view.moment === "ROOM" ? `In a room: ${view.roomLabel ?? "unknown room"}` : REMINDER_MOMENT_LABEL[view.moment];
}

function formatWhen(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

/* ── The form (add and edit) ─────────────────────────────────────────────── */

function ReminderForm({
  initial,
  cleaners,
  todayKey,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  cleaners: PropertyRemindersView["cleaners"];
  todayKey: string;
  submitLabel: string;
  onSubmit: (draft: Draft) => Promise<void>;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = React.useState<Draft>(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const problem = draftProblem(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(draft);
      setDraft(EMPTY_DRAFT);
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : "Not saved."} Your entry is still here.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <fieldset disabled={saving} className="space-y-3">
        <EField label="Reminder" hint={`What the cleaner reads. Up to ${REMINDER_TEXT_MAX} characters.`}>
          <ETextarea value={draft.text} maxLength={REMINDER_TEXT_MAX} onChange={(event) => set("text", event.target.value)} placeholder="e.g. Wipe the top of the rangehood; the client checks it." />
        </EField>
        <div className="grid gap-3 sm:grid-cols-2">
          <EField label="When the cleaner sees it">
            <ESelect value={draft.moment} onChange={(event) => set("moment", event.target.value as ReminderMoment)}>
              <option value="BEFORE_START">Before start (must be read before clock-in)</option>
              <option value="ROOM">At the top of a room</option>
              <option value="BEFORE_LEAVING">Before leaving (wrap up)</option>
            </ESelect>
          </EField>
          {draft.moment === "ROOM" ? (
            <EField label="Room" hint="Shown only if the job's form has this room.">
              <ESelect value={draft.roomKey} onChange={(event) => set("roomKey", event.target.value as ReminderRoomKey)}>
                {REMINDER_ROOM_KEYS.map((key) => (
                  <option key={key} value={key}>{REMINDER_ROOM_LABEL[key]}</option>
                ))}
              </ESelect>
            </EField>
          ) : null}
          <EField label="Who sees it">
            <ESelect value={draft.cleanerId} onChange={(event) => set("cleanerId", event.target.value)}>
              <option value="">Every cleaner at this property</option>
              {cleaners.map((cleaner) => (
                <option key={cleaner.id} value={cleaner.id}>Only {cleaner.name}</option>
              ))}
            </ESelect>
          </EField>
          <EField label="How long">
            <ESelect value={draft.lifetime} onChange={(event) => set("lifetime", event.target.value as ReminderLifetime)}>
              <option value="EVERY_JOB">Every job until ended</option>
              <option value="NEXT_JOBS">The next jobs only</option>
              <option value="UNTIL_DATE">Until a date</option>
            </ESelect>
          </EField>
          {draft.lifetime === "NEXT_JOBS" ? (
            <EField label="Number of jobs" hint="1 = the next job. Counted when a cleaner clocks in.">
              <EInput inputMode="numeric" maxLength={2} value={draft.jobsCount} onChange={(event) => set("jobsCount", event.target.value.replace(/\D/g, ""))} />
            </EField>
          ) : null}
          {draft.lifetime === "UNTIL_DATE" ? (
            <EField label="Last day (inclusive)">
              <EInput type="date" min={todayKey} value={draft.untilDate} onChange={(event) => set("untilDate", event.target.value)} />
            </EField>
          ) : null}
        </div>
        <ESwitch
          checked={draft.mustConfirm}
          onCheckedChange={(value) => set("mustConfirm", value)}
          label="Must confirm: the cleaner taps Done (a room cannot be marked done, or the job submitted, until then)"
        />
        <EField label="Why (optional)" hint="Shown to the cleaner under the reminder, e.g. a client complaint on 3 Nov.">
          <EInput value={draft.reason} maxLength={500} onChange={(event) => set("reason", event.target.value)} />
        </EField>
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <EButton type="submit" size="sm">{saving ? "Saving…" : submitLabel}</EButton>
          {onCancel ? <EButton type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</EButton> : null}
        </div>
      </fieldset>
    </form>
  );
}

/* ── One reminder in the list ────────────────────────────────────────────── */

function ReminderRow({
  view,
  propertyId,
  cleaners,
  todayKey,
  timeZone,
  onChanged,
}: {
  view: OfficeReminderView;
  propertyId: string;
  cleaners: PropertyRemindersView["cleaners"];
  todayKey: string;
  timeZone: string;
  onChanged: (message: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [ending, setEnding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const url = `/api/admin/properties/${propertyId}/reminders/${view.id}`;

  async function end() {
    setEnding(true);
    setError(null);
    try {
      await sendJson(url, "PATCH", { action: "end", expectedUpdatedAt: view.updatedAt });
      onChanged("Reminder ended. Cleaners no longer see it.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Not ended.");
    } finally {
      setEnding(false);
    }
  }

  return (
    <li className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
      {editing ? (
        <ReminderForm
          initial={draftFrom(view)}
          cleaners={cleaners}
          todayKey={todayKey}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (draft) => {
            await sendJson(url, "PATCH", { action: "edit", expectedUpdatedAt: view.updatedAt, reminder: payloadFrom(draft) });
            setEditing(false);
            onChanged("Reminder saved.");
          }}
        />
      ) : (
        <div className="space-y-1.5">
          <p className="text-[0.875rem] font-[600] [overflow-wrap:anywhere]">{view.text}</p>
          <div className="flex flex-wrap gap-1.5">
            <EPill tone="info">{whereLabel(view)}</EPill>
            <EPill tone="neutral">{view.cleaner ? `Only ${view.cleaner.name}` : "Every cleaner"}</EPill>
            {view.mustConfirm ? <EPill tone="warn">Must confirm</EPill> : null}
            {view.finished ? <EPill tone="neutral">Run its course</EPill> : null}
          </div>
          <p className={MUTED}>
            <span className="font-[550]">Ends:</span> {view.endsLabel}. <span className="font-[550]">Why:</span> {view.why}
          </p>
          <p className={MUTED}>
            Used on {view.usedOnJobs} job{view.usedOnJobs === 1 ? "" : "s"}, confirmed {view.confirmations} time{view.confirmations === 1 ? "" : "s"}. Written by {view.createdBy}, {formatWhen(view.createdAt, timeZone)}.
          </p>
          {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <EButton type="button" size="sm" variant="outline" disabled={ending} onClick={() => setEditing(true)}>Edit</EButton>
            <EButton type="button" size="sm" variant="outline" disabled={ending} onClick={end}>{ending ? "Ending…" : "End reminder"}</EButton>
          </div>
        </div>
      )}
    </li>
  );
}

/* ── The panel ───────────────────────────────────────────────────────────── */

export function PropertyRemindersPanel({ propertyId, timeZone = "Australia/Sydney" }: { propertyId: string; timeZone?: string }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [adding, setAdding] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/admin/properties/${propertyId}/reminders`, { cache: "no-store", signal: controller.signal });
        const body = (await response.json().catch(() => null)) as (PropertyRemindersView & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body) {
          setLoad({ status: "error", message: body?.error ?? "Could not load the reminders." });
          return;
        }
        setLoad({ status: "ready", data: body });
      } catch {
        if (!controller.signal.aborted) setLoad({ status: "error", message: "Could not load the reminders." });
      }
    })();
    return () => controller.abort();
  }, [propertyId, version]);

  const reload = (message: string) => {
    setNotice(message);
    setVersion((value) => value + 1);
  };

  if (load.status === "loading") return <p role="status" className={MUTED}>Loading reminders…</p>;
  if (load.status === "error") {
    return (
      <EAlert tone="danger" title="Reminders could not be loaded">
        <p>{load.message}</p>
        <EButton type="button" size="sm" variant="outline" className="mt-2" onClick={() => setVersion((value) => value + 1)}>Try again</EButton>
      </EAlert>
    );
  }

  const { data } = load;
  const pilotNotice = PILOT_NOTICE[data.pilot];
  return (
    <div className="space-y-4">
      <p className={MUTED}>
        Short notes cleaners read at the right moment. Before start: up to five, read before clock-in. In a room: up to three at the top of that room. More go under &ldquo;More notes&rdquo;.
      </p>
      {pilotNotice ? <EAlert tone="warning">{pilotNotice}</EAlert> : null}
      {notice ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-success))]">{notice}</p> : null}

      {data.active.length === 0 ? (
        <p className={MUTED}>No active reminders at this property.</p>
      ) : (
        <ul className="space-y-2" aria-label="Active reminders">
          {data.active.map((view) => (
            <ReminderRow key={`${view.id}-${view.updatedAt}`} view={view} propertyId={propertyId} cleaners={data.cleaners} todayKey={data.todayKey} timeZone={timeZone} onChanged={reload} />
          ))}
        </ul>
      )}

      {adding ? (
        <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
          <h3 className="mb-2 text-[0.875rem] font-[600]">New reminder</h3>
          <ReminderForm
            initial={EMPTY_DRAFT}
            cleaners={data.cleaners}
            todayKey={data.todayKey}
            submitLabel="Save reminder"
            onCancel={() => setAdding(false)}
            onSubmit={async (draft) => {
              await sendJson(`/api/admin/properties/${propertyId}/reminders`, "POST", payloadFrom(draft));
              setAdding(false);
              reload("Reminder saved.");
            }}
          />
        </div>
      ) : (
        <EButton type="button" size="sm" onClick={() => { setNotice(null); setAdding(true); }}>Add reminder</EButton>
      )}

      {data.ended.length > 0 ? (
        <details className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
          <summary className="cursor-pointer text-[0.8125rem] font-[600]">Ended in the last 90 days ({data.ended.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {data.ended.map((view) => (
              <li key={view.id} className={MUTED}>
                <span className="font-[550] text-[hsl(var(--e-foreground))] [overflow-wrap:anywhere]">{view.text}</span> — {whereLabel(view)}; ended by {view.endedBy ?? "unknown"}{view.endedAt ? `, ${formatWhen(view.endedAt, timeZone)}` : ""}; used on {view.usedOnJobs} job{view.usedOnJobs === 1 ? "" : "s"}.
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
