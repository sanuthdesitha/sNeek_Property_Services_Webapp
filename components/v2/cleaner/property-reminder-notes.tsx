"use client";

/**
 * Smart property reminders on the cleaner's job screen (pilot "Property
 * reminders", 2026-11-28): the notes at the top of a room section, the
 * "Before you leave" list in Wrap up and "More notes" (over the caps). Every
 * note says why it exists. "Done" records the cleaner's confirmation for this
 * job (POST /api/cleaner/jobs/[id]/reminders/ack); a must-confirm note keeps
 * its room from being marked done, or the job from being submitted, until then.
 *
 * The plan comes from the server (GET /api/jobs/[id]/form,
 * `propertyReminderPlan`); null = pilot off, nothing is drawn.
 */
import * as React from "react";
import { BellRing, CheckCircle2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import type { ReminderItem, ReminderPlan } from "@/lib/properties/reminders/model";

export type ReminderPlanPayload = (ReminderPlan & { status: "ok"; confirmedKeys: string[] }) | { status: "unavailable" } | null;

export type ReminderConfirmApi = {
  plan: ReminderPlanPayload;
  confirmed: ReadonlySet<string>;
  busyKey: string | null;
  error: string | null;
  confirm: (key: string) => Promise<void>;
};

export function readReminderPlan(payload: unknown): ReminderPlanPayload {
  const plan = (payload as { propertyReminderPlan?: unknown } | null)?.propertyReminderPlan;
  if (!plan || typeof plan !== "object") return null;
  const status = (plan as { status?: unknown }).status;
  if (status === "unavailable") return { status: "unavailable" };
  if (status !== "ok") return null;
  const value = plan as ReminderPlan & { confirmedKeys?: unknown };
  return {
    status: "ok",
    rooms: Array.isArray(value.rooms) ? value.rooms : [],
    leaving: Array.isArray(value.leaving) ? value.leaving : [],
    more: Array.isArray(value.more) ? value.more : [],
    confirmedKeys: Array.isArray(value.confirmedKeys) ? value.confirmedKeys.filter((key): key is string => typeof key === "string") : [],
  };
}

/**
 * Confirmation state shared by the room notes and Wrap up. Starts from the
 * server's list for this job and person; a new job starts fresh.
 */
export function useReminderConfirm(jobId: string, payload: unknown, enabled: boolean): ReminderConfirmApi {
  const plan = React.useMemo(() => (enabled ? readReminderPlan(payload) : null), [enabled, payload]);
  const serverKeys = plan?.status === "ok" ? plan.confirmedKeys.join("\n") : "";
  const [local, setLocal] = React.useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLocal(new Set());
    setError(null);
  }, [jobId]);

  const confirmed = React.useMemo(() => {
    const all = new Set(local);
    for (const key of serverKeys ? serverKeys.split("\n") : []) all.add(key);
    return all;
  }, [local, serverKeys]);

  const confirm = React.useCallback(
    async (key: string) => {
      setBusyKey(key);
      setError(null);
      try {
        const response = await fetch(`/api/cleaner/jobs/${jobId}/reminders/ack`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reminderKey: key }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error ?? "Not saved. Try again.");
        setLocal((current) => new Set(current).add(key));
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Not saved. Try again.");
      } finally {
        setBusyKey(null);
      }
    },
    [jobId],
  );

  return { plan, confirmed, busyKey, error, confirm };
}

function ReminderLine({ item, api, disabled }: { item: ReminderItem; api: ReminderConfirmApi; disabled?: boolean }) {
  const done = api.confirmed.has(item.key);
  return (
    <li className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-[0.8125rem] font-[600] [overflow-wrap:anywhere]">
          {item.text}
          {item.mustConfirm && !done ? <span className="ml-1.5 text-[0.6875rem] font-[650] uppercase tracking-wide">Must confirm</span> : null}
        </p>
        <p className="text-[0.75rem] opacity-80 [overflow-wrap:anywhere]">{item.why}</p>
      </div>
      {done ? (
        <span className="inline-flex items-center gap-1 text-[0.75rem] font-[600] text-[hsl(var(--e-success))]">
          <CheckCircle2 aria-hidden className="h-4 w-4" /> Done
        </span>
      ) : (
        <EButton type="button" size="sm" variant="outline" disabled={disabled || api.busyKey !== null} onClick={() => void api.confirm(item.key)}>
          {api.busyKey === item.key ? "Saving…" : "Done"}
        </EButton>
      )}
    </li>
  );
}

/** At the top of a room section. */
export function RoomReminderNotes({ items, api, disabled }: { items: readonly ReminderItem[]; api: ReminderConfirmApi; disabled?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className={`rounded-[var(--e-radius)] ${toneNoticeClass("info")} p-3`}>
      <p className="mb-1.5 flex items-center gap-1.5 text-[0.75rem] font-[650]">
        <BellRing aria-hidden className="h-3.5 w-3.5" /> Reminders for this room
      </p>
      <ul className="space-y-2">
        {items.map((item) => (
          <ReminderLine key={item.key} item={item} api={api} disabled={disabled} />
        ))}
      </ul>
      {api.error ? <p role="alert" className="mt-1.5 text-[0.75rem] text-[hsl(var(--e-danger))]">{api.error}</p> : null}
    </div>
  );
}

/** Wrap up: what to check before leaving. */
export function LeavingReminders({ api, disabled }: { api: ReminderConfirmApi; disabled?: boolean }) {
  if (api.plan?.status === "unavailable") {
    return <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-warning))]">Property reminders could not be loaded. Reload the job to see them.</p>;
  }
  const items = api.plan?.status === "ok" ? api.plan.leaving : [];
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="leaving-reminders-title" className={`rounded-[var(--e-radius)] ${toneNoticeClass("attention")} p-3`}>
      <h3 id="leaving-reminders-title" className="mb-1.5 flex items-center gap-1.5 text-[0.8125rem] font-[650]">
        <BellRing aria-hidden className="h-4 w-4" /> Before you leave
      </h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <ReminderLine key={item.key} item={item} api={api} disabled={disabled} />
        ))}
      </ul>
      {api.error ? <p role="alert" className="mt-1.5 text-[0.75rem] text-[hsl(var(--e-danger))]">{api.error}</p> : null}
    </section>
  );
}

/** Over the caps: read, nothing to confirm. */
export function MoreReminderNotes({ api }: { api: ReminderConfirmApi }) {
  const items = api.plan?.status === "ok" ? api.plan.more : [];
  if (items.length === 0) return null;
  return (
    <details className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
      <summary className="cursor-pointer text-[0.8125rem] font-[600]">More notes ({items.length})</summary>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item.key}>
            <p className="text-[0.8125rem] font-[550] [overflow-wrap:anywhere]">{item.text}</p>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{item.why}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Must-confirm room notes not yet confirmed, as "still missing" entries for the room stepper. */
export function unconfirmedRoomItems(api: ReminderConfirmApi | undefined, sectionId: string): Array<{ fieldId: string; label: string }> {
  if (!api || api.plan?.status !== "ok") return [];
  const group = api.plan.rooms.find((entry) => entry.sectionId === sectionId);
  return (group?.items ?? [])
    .filter((item) => item.mustConfirm && !api.confirmed.has(item.key))
    .map((item) => ({ fieldId: `reminder:${item.key}`, label: `Tap Done on the reminder: ${item.text}` }));
}

/** The room notes for one section (top of that section). */
export function roomItemsFor(api: ReminderConfirmApi | undefined, sectionId: string): ReminderItem[] {
  if (!api || api.plan?.status !== "ok") return [];
  return api.plan.rooms.find((entry) => entry.sectionId === sectionId)?.items ?? [];
}
