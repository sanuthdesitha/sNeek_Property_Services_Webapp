"use client";

/**
 * Visit and access sheet (board "Maintenance", phone frame 5): when the visit
 * worker goes, whether they see the property's access details, and who they
 * call. Saved through the existing assign endpoint with the current visit
 * worker, so nothing else on the item changes.
 *
 * The date and time are the organisation's local time. Empty means "not booked
 * yet": the sheet never fills in today. Fields lock while saving; a failed save
 * keeps what was typed and the button reads "Try again".
 */
import * as React from "react";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { EButton } from "@/components/v2/ui/primitives";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EField, EInput, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import { assignVisitWorker } from "./maintenance-api";

export type VisitTarget = {
  id: string;
  title: string;
  propertyLine: string;
  assignedWorkerId: string | null;
  assignedWorkerName: string | null;
  scheduledFor: string | null;
  shareAccess: boolean;
  contactPersonUserId: string | null;
};

type OfficeUser = { id: string; name: string | null; email: string | null; role: string };

type VisitDraft = { date: string; time: string; shareAccess: boolean; contactPersonUserId: string };

const PHONE_INPUT = "max-sm:h-11 max-sm:text-base";

function draftFor(target: VisitTarget, timeZone: string): VisitDraft {
  const at = target.scheduledFor ? new Date(target.scheduledFor) : null;
  const valid = at && !Number.isNaN(at.getTime());
  return {
    date: valid ? formatInTimeZone(at, timeZone, "yyyy-MM-dd") : "",
    time: valid ? formatInTimeZone(at, timeZone, "HH:mm") : "",
    shareAccess: target.shareAccess,
    contactPersonUserId: target.contactPersonUserId ?? "",
  };
}

/** The visit instant from the organisation's local date and time; null for "not booked". */
export function visitInstant(date: string, time: string, timeZone: string): { iso: string | null; error: string | null } {
  if (!date && !time) return { iso: null, error: null };
  if (!date || !time) return { iso: null, error: "Add both a date and a time, or clear both for not booked yet." };
  const instant = fromZonedTime(`${date}T${time}:00`, timeZone);
  if (Number.isNaN(instant.getTime())) return { iso: null, error: "That date or time is not valid." };
  return { iso: instant.toISOString(), error: null };
}

function useOfficeUsers(active: boolean): { users: OfficeUser[] | null; error: string | null } {
  const [users, setUsers] = React.useState<OfficeUser[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!active || users) return;
    const controller = new AbortController();
    fetch("/api/admin/users", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as OfficeUser[] | { error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !Array.isArray(body)) throw new Error("The office contacts could not be loaded.");
        setUsers(body.filter((user) => user.role === "ADMIN" || user.role === "OPS_MANAGER"));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The office contacts could not be loaded.");
      });
    return () => controller.abort();
  }, [active, users]);
  return { users, error };
}

export function VisitSheet({
  open,
  target,
  timeZone,
  onClose,
  onAssignFirst,
  onSaved,
}: {
  open: boolean;
  target: VisitTarget | null;
  timeZone: string;
  onClose: () => void;
  /** No visit worker yet: open the assign sheet instead. */
  onAssignFirst: () => void;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = React.useState<VisitDraft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const { users, error: usersError } = useOfficeUsers(open);

  // A different item starts from its own saved visit; reopening the same item keeps the draft.
  React.useEffect(() => {
    setDraft(target ? draftFor(target, timeZone) : null);
    setError(null);
    setFailed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  if (!target || !draft) return null;
  const set = (patch: Partial<VisitDraft>) => setDraft((current) => (current ? { ...current, ...patch } : current));

  async function save() {
    if (!target || !draft || !target.assignedWorkerId) return;
    const instant = visitInstant(draft.date, draft.time, timeZone);
    if (instant.error) {
      setError(instant.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await assignVisitWorker(target.id, {
        workerId: target.assignedWorkerId,
        scheduledFor: instant.iso,
        shareAccess: draft.shareAccess,
        contactPersonUserId: draft.contactPersonUserId || null,
      });
      setFailed(false);
      onSaved(result.unchanged ? "Nothing changed." : instant.iso ? "Visit saved." : "Visit saved as not booked yet.");
    } catch (cause) {
      setFailed(true);
      setError(cause instanceof Error ? cause.message : "The visit could not be saved. Your answers are kept.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EActionDialog
      open={open}
      busy={busy}
      onClose={onClose}
      title={`Visit · ${target.title}`}
      description={target.propertyLine}
      footer={
        target.assignedWorkerId ? (
          <>
            <EButton variant="outline" onClick={onClose} disabled={busy}>Cancel</EButton>
            <EButton onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : failed ? "Try again" : "Save visit"}</EButton>
          </>
        ) : (
          <>
            <EButton variant="outline" onClick={onClose}>Cancel</EButton>
            <EButton onClick={onAssignFirst}>Assign a worker</EButton>
          </>
        )
      }
    >
      {!target.assignedWorkerId ? (
        <p className="text-[0.875rem]">Nobody is booked to visit yet. Assign a visit worker first; the visit time, access and contact belong to that worker.</p>
      ) : (
        <fieldset disabled={busy} className="min-w-0 space-y-3">
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Visit worker: {target.assignedWorkerName ?? "Not recorded"}</p>
          <div className="grid grid-cols-[1fr_8rem] gap-2">
            <EField label="Date">
              <EInput type="date" value={draft.date} onChange={(event) => set({ date: event.target.value })} className={PHONE_INPUT} />
            </EField>
            <EField label="Time">
              <EInput type="time" value={draft.time} onChange={(event) => set({ time: event.target.value })} className={PHONE_INPUT} />
            </EField>
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Empty means &ldquo;not booked yet&rdquo;. We never fill in today for you. Times are {timeZone} time.
          </p>
          <div className="flex min-h-12 items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[0.875rem] font-semibold">Share property access</p>
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Lockbox code and entry notes in their portal</p>
            </div>
            <ESwitch checked={draft.shareAccess} onCheckedChange={(value) => set({ shareAccess: value })} label={<span className="sr-only">Share property access</span>} />
          </div>
          <EField label="Contact person">
            <ESelect value={draft.contactPersonUserId} onChange={(event) => set({ contactPersonUserId: event.target.value })} className={PHONE_INPUT}>
              <option value="">No contact person</option>
              {(users ?? []).map((user) => (
                <option key={user.id} value={user.id}>{user.name ?? user.email ?? "Unnamed"}</option>
              ))}
              {draft.contactPersonUserId && users && !users.some((user) => user.id === draft.contactPersonUserId) ? (
                <option value={draft.contactPersonUserId}>Current contact</option>
              ) : null}
            </ESelect>
          </EField>
          {usersError ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{usersError}</p> : null}
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Instructions for the worker are kept in their own card on the item page.</p>
        </fieldset>
      )}
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
    </EActionDialog>
  );
}
