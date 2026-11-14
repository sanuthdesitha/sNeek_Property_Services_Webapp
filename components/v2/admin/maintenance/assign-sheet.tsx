"use client";

/**
 * Assign sheet (board "Maintenance", phone frame 4): who goes, opened from the
 * list's "Assign…", the row menu's "Reassign or schedule…", the side panel's
 * Reassign and the item page. A bottom sheet on a phone, a dialog from 640px.
 *
 * Segments, each saved on its own through the endpoint that already owns it:
 *  - Maintenance: the visit worker (MaintenanceWorker, through the bulk
 *    assign, which keeps the booked visit, access and contact as stored), plus anyone with
 *    a Maintenance login in the item's roster;
 *  - Cleaner and QA: the item's roster for that role (POST …/assignees).
 * With several items selected only the visit worker can be chosen (one bulk
 * request; the roster is per item).
 *
 * Closing keeps the choice until another item is opened. A slow answer for an
 * item that is no longer open never fills the sheet.
 */
import * as React from "react";
import { MaintenanceAssigneeRole } from "@prisma/client";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EField, EInput } from "@/components/v2/admin/estate-kit";
import { MAINTENANCE_ASSIGNEE_ROLE_LABELS } from "@/lib/maintenance/assignment-roles";
import { bulkAssign, createWorker, saveRoleRoster, type AssignResult } from "./maintenance-api";
import { initials } from "./maintenance-format";

export type AssignTarget = {
  ids: string[];
  title: string;
  /** The current visit worker when one item is open; null for several. */
  assignedWorkerId: string | null;
};

export type AssignDone = { message: string; kind: "worker" | "roster"; refused?: AssignResult[] };

export type WorkerOption = {
  id: string;
  name: string;
  trade: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  userId: string | null;
  isActive: boolean;
  isPermanent: boolean;
  openItems?: number;
  lastVisitAt?: string | null;
};

type Candidate = { id: string; name: string | null; email: string | null };
type RosterRow = { role: MaintenanceAssigneeRole; userId: string; removedAt: string | null; notifiedAt: string | null };
type Roster = { rows: RosterRow[]; candidates: Record<MaintenanceAssigneeRole, Candidate[]> };
type Segment = "MAINTENANCE" | "CLEANER" | "QA";

const SEGMENTS: Array<{ key: Segment; label: string }> = [
  { key: "MAINTENANCE", label: "Maintenance" },
  { key: "CLEANER", label: "Cleaner" },
  { key: "QA", label: "QA" },
];

const PHONE_INPUT = "max-sm:h-11 max-sm:text-base";

export function workerLine(worker: WorkerOption): string {
  const parts = [worker.trade, worker.company, worker.userId ? "has login" : "ad hoc, no login"];
  if (typeof worker.openItems === "number") parts.push(`${worker.openItems} open`);
  return parts.filter(Boolean).join(" · ");
}

/** Loads the worker list once per sheet opening; aborts when the sheet goes away. */
function useWorkers(active: boolean, revision: number): { workers: WorkerOption[] | null; error: string | null } {
  const [workers, setWorkers] = React.useState<WorkerOption[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setError(null);
    fetch("/api/admin/maintenance/workers", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { workers?: WorkerOption[]; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body || !Array.isArray(body.workers)) throw new Error(body?.error ?? "The workers could not be loaded.");
        setWorkers(body.workers);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The workers could not be loaded.");
      });
    return () => controller.abort();
  }, [active, revision]);
  return { workers, error };
}

/** The roster for one item; a reply for a different item is ignored. */
function useRoster(itemId: string | null, revision: number): { roster: Roster | null; error: string | null } {
  const [roster, setRoster] = React.useState<Roster | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setRoster(null);
    setError(null);
    if (!itemId) return;
    const controller = new AbortController();
    fetch(`/api/admin/maintenance/${encodeURIComponent(itemId)}/assignees`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { assignments?: RosterRow[]; candidates?: Roster["candidates"]; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body || !Array.isArray(body.assignments)) throw new Error(body?.error ?? "The people on this item could not be loaded.");
        setRoster({
          rows: body.assignments,
          candidates: { MAINTENANCE: [], CLEANER: [], QA: [], ...(body.candidates ?? {}) },
        });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The people on this item could not be loaded.");
      });
    return () => controller.abort();
  }, [itemId, revision]);
  return { roster, error };
}

function activeIds(roster: Roster | null, role: Segment): string[] {
  return (roster?.rows ?? []).filter((row) => row.role === role && !row.removedAt).map((row) => row.userId);
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

export function AssignSheet({
  open,
  target,
  initialSegment = "MAINTENANCE",
  canCreateLogin,
  onClose,
  onDone,
}: {
  open: boolean;
  target: AssignTarget | null;
  initialSegment?: Segment;
  canCreateLogin: boolean;
  onClose: () => void;
  /** After a successful save: a sentence for the toast, what was saved, and refused items (bulk). */
  onDone: (result: AssignDone) => void;
}) {
  const idsKey = target?.ids.join(",") ?? "";
  const single = target && target.ids.length === 1 ? target.ids[0] : null;
  const [segment, setSegment] = React.useState<Segment>(initialSegment);
  const [query, setQuery] = React.useState("");
  const [workerId, setWorkerId] = React.useState("");
  const [picked, setPicked] = React.useState<Record<Segment, string[] | null>>({ MAINTENANCE: null, CLEANER: null, QA: null });
  const [adding, setAdding] = React.useState(false);
  const [newWorker, setNewWorker] = React.useState({ name: "", phone: "", email: "", trade: "", company: "" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [workerRevision, setWorkerRevision] = React.useState(0);
  const [rosterRevision, setRosterRevision] = React.useState(0);
  const { workers, error: workersError } = useWorkers(open, workerRevision);
  const { roster, error: rosterError } = useRoster(open ? single : null, rosterRevision);

  // A different item (or set of items) starts from its own saved state.
  React.useEffect(() => {
    setSegment(initialSegment);
    setQuery("");
    setWorkerId(target?.assignedWorkerId ?? "");
    setPicked({ MAINTENANCE: null, CLEANER: null, QA: null });
    setAdding(false);
    setNewWorker({ name: "", phone: "", email: "", trade: "", company: "" });
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  React.useEffect(() => {
    if (open) setSegment(initialSegment);
  }, [open, initialSegment]);

  if (!target) return null;
  const bulk = target.ids.length > 1;
  const shown = (workers ?? [])
    .filter((worker) => worker.isActive || worker.id === target.assignedWorkerId)
    .filter((worker) => {
      const text = query.trim().toLowerCase();
      return !text || [worker.name, worker.trade, worker.company].some((value) => value?.toLowerCase().includes(text));
    });
  const chosenWorker = (workers ?? []).find((worker) => worker.id === workerId) ?? null;

  function rolePicked(role: Segment): string[] {
    return picked[role] ?? activeIds(roster, role);
  }

  function toggle(role: Segment, userId: string) {
    const current = rolePicked(role);
    setPicked((prev) => ({ ...prev, [role]: current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId] }));
  }

  async function saveWorker() {
    if (!target || !workerId) {
      setError("Choose a worker.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const name = chosenWorker?.name ?? "the worker";
      // Always the bulk endpoint: it leaves the booked visit, access and contact
      // exactly as stored, so a list row that never loaded them cannot clear them.
      const results = await bulkAssign(target.ids, workerId);
      const done = results.filter((result) => result.outcome === "done").length;
      const refused = results.filter((result) => result.outcome === "refused");
      if (bulk) {
        onDone({ kind: "worker", message: `${name} assigned to ${done} ${done === 1 ? "item" : "items"}${refused.length ? `; ${refused.length} refused` : ""}.`, refused });
      } else if (refused.length > 0) {
        setError(refused[0].reason ?? "Could not assign this item.");
        return;
      } else if (done === 0) {
        onDone({ kind: "worker", message: `${name} was already assigned.` });
      } else {
        onDone({ kind: "worker", message: chosenWorker?.userId ? `${name} assigned. They get a notice in their portal.` : `${name} assigned. They have no portal login, so call them.` });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not assign. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveRole(role: Segment) {
    if (!single) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveRoleRoster(single, role, rolePicked(role));
      const added = result.added?.length ?? 0;
      const removed = result.removed?.length ?? 0;
      const label = MAINTENANCE_ASSIGNEE_ROLE_LABELS[role].toLowerCase();
      setPicked((prev) => ({ ...prev, [role]: null }));
      setRosterRevision((value) => value + 1);
      onDone({ kind: "roster", message: added > 0 ? `${added} ${label}${added === 1 ? "" : "s"} added; the assignment email is being sent.` : removed > 0 ? `${removed} ${label}${removed === 1 ? "" : "s"} removed.` : "No change." });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this role.");
    } finally {
      setBusy(false);
    }
  }

  async function addWorker() {
    if (!newWorker.name.trim()) {
      setError("Enter a name for the worker.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createWorker({
        name: newWorker.name.trim(),
        phone: newWorker.phone.trim() || undefined,
        email: newWorker.email.trim() || undefined,
        trade: newWorker.trade.trim() || undefined,
        company: newWorker.company.trim() || undefined,
      });
      if (created.id) setWorkerId(created.id);
      setAdding(false);
      setNewWorker({ name: "", phone: "", email: "", trade: "", company: "" });
      setWorkerRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the worker.");
    } finally {
      setBusy(false);
    }
  }

  function rosterList(role: Segment) {
    const candidates = roster?.candidates[role] ?? [];
    const saved = activeIds(roster, role);
    const chosen = rolePicked(role);
    const dirty = !sameSet(chosen, saved);
    if (rosterError) return <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{rosterError}</p>;
    if (!roster) return <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading people…</p>;
    return (
      <div className="space-y-2">
        {candidates.length === 0 ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No active accounts with this role.</p>
        ) : (
          <ul className="max-h-64 divide-y divide-[hsl(var(--e-border))] overflow-y-auto">
            {candidates.map((person) => {
              const row = roster.rows.find((entry) => entry.role === role && entry.userId === person.id && !entry.removedAt);
              return (
                <li key={person.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2.5 py-1.5 text-[0.875rem]">
                    <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--e-primary))] max-sm:h-5 max-sm:w-5" checked={chosen.includes(person.id)} onChange={() => toggle(role, person.id)} />
                    <span className="min-w-0 flex-1 truncate">{person.name ?? person.email ?? "Unnamed"}</span>
                    {row ? <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.notifiedAt ? "emailed" : "not emailed"}</span> : null}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <EButton size="sm" disabled={!dirty || busy} onClick={() => void saveRole(role)}>
            Save {role === "MAINTENANCE" ? "maintenance logins" : `${MAINTENANCE_ASSIGNEE_ROLE_LABELS[role].toLowerCase()}s`}
          </EButton>
          {dirty ? (
            <EButton size="sm" variant="ghost" disabled={busy} onClick={() => setPicked((prev) => ({ ...prev, [role]: null }))}>
              Reset
            </EButton>
          ) : null}
        </div>
      </div>
    );
  }

  const workerPicker = (
    <div className="space-y-2">
      <EField label="Search workers">
        <EInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, trade or company" className={PHONE_INPUT} />
      </EField>
      {workersError ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{workersError}</p> : null}
      {!workers && !workersError ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading workers…</p> : null}
      {workers && shown.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{query ? "No worker matches." : "No workers yet. Add one below."}</p> : null}
      {shown.length > 0 ? (
        <div role="radiogroup" aria-label="Visit worker" className="max-h-64 divide-y divide-[hsl(var(--e-border))] overflow-y-auto">
          {shown.map((worker) => (
            <label key={worker.id} className="flex min-h-12 cursor-pointer items-center gap-2.5 py-1.5">
              <input type="radio" name={`worker-${idsKey}`} className="h-4 w-4 accent-[hsl(var(--e-primary))] max-sm:h-5 max-sm:w-5" checked={workerId === worker.id} onChange={() => setWorkerId(worker.id)} />
              <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--e-primary-soft))] text-[0.6875rem] font-semibold text-[hsl(var(--e-primary))]">{initials(worker.name)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.875rem] font-semibold">{worker.name}{worker.isActive ? "" : " (inactive)"}</span>
                <span className="block truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{workerLine(worker)}</span>
              </span>
            </label>
          ))}
        </div>
      ) : null}
      {adding ? (
        <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
          <EField label="Name">
            <EInput value={newWorker.name} onChange={(event) => setNewWorker((v) => ({ ...v, name: event.target.value }))} className={PHONE_INPUT} />
          </EField>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <EField label="Phone"><EInput value={newWorker.phone} inputMode="tel" onChange={(event) => setNewWorker((v) => ({ ...v, phone: event.target.value }))} className={PHONE_INPUT} /></EField>
            <EField label="Email"><EInput value={newWorker.email} type="email" onChange={(event) => setNewWorker((v) => ({ ...v, email: event.target.value }))} className={PHONE_INPUT} /></EField>
            <EField label="Trade"><EInput value={newWorker.trade} placeholder="e.g. Plumber" onChange={(event) => setNewWorker((v) => ({ ...v, trade: event.target.value }))} className={PHONE_INPUT} /></EField>
            <EField label="Company"><EInput value={newWorker.company} onChange={(event) => setNewWorker((v) => ({ ...v, company: event.target.value }))} className={PHONE_INPUT} /></EField>
          </div>
          <div className="flex gap-2">
            <EButton size="sm" disabled={busy} onClick={() => void addWorker()}>Save worker</EButton>
            <EButton size="sm" variant="ghost" disabled={busy} onClick={() => setAdding(false)}>Cancel</EButton>
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            A new worker has no portal login. {canCreateLogin ? "Create one later from People and trades." : "An administrator can create one from People and trades."}
          </p>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex min-h-11 items-center gap-1 text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
          <Plus aria-hidden className="h-3.5 w-3.5" /> Add a new worker
        </button>
      )}
    </div>
  );

  return (
    <EActionDialog
      open={open}
      busy={busy}
      onClose={onClose}
      title={bulk ? `Assign · ${target.ids.length} items` : `Assign · ${target.title}`}
      footer={
        segment === "MAINTENANCE" || bulk ? (
          <>
            <EButton variant="outline" onClick={onClose} disabled={busy}>Cancel</EButton>
            <EButton onClick={() => void saveWorker()} disabled={busy || !workerId || (!bulk && workerId === target.assignedWorkerId)}>
              {busy ? "Assigning…" : chosenWorker ? `Assign ${chosenWorker.name}${bulk ? ` to ${target.ids.length}` : ""}` : "Assign"}
            </EButton>
          </>
        ) : (
          <EButton variant="outline" onClick={onClose} disabled={busy}>Close</EButton>
        )
      }
    >
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        {!bulk ? (
          <div role="group" aria-label="Role" className="grid grid-cols-3 gap-1 rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] p-1">
            {SEGMENTS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                aria-pressed={segment === entry.key}
                onClick={() => setSegment(entry.key)}
                className={cn(
                  "min-h-9 rounded-[var(--e-radius-sm)] text-[0.8125rem] font-[550] max-sm:min-h-11",
                  segment === entry.key ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]" : "text-[hsl(var(--e-muted-foreground))]",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">One visit worker on every selected item. Booked visits, access and contacts stay as they are.</p>
        )}
        {segment === "MAINTENANCE" || bulk ? (
          <>
            {workerPicker}
            {!bulk ? (
              <div className="space-y-2 border-t border-[hsl(var(--e-border))] pt-3">
                <p className="text-[0.8125rem] font-semibold">Maintenance logins on this item</p>
                {rosterList("MAINTENANCE")}
              </div>
            ) : null}
          </>
        ) : (
          rosterList(segment)
        )}
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Each role is saved on its own. A visit worker with a portal login gets a notice in their portal; one without a login is not notified, so call them. People added under a role are emailed. Pay is set per person under Who is on this once they are on the item.
        </p>
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      </fieldset>
    </EActionDialog>
  );
}
