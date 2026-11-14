"use client";

/**
 * The small admin Maintenance dialogs, all on the shared EActionDialog (a
 * bottom sheet on a phone):
 *  - StatusNoteDialog: "Mark resolved…" and "Dismiss…", a tier A confirm on
 *    the shared EConfirmDialog with one optional note that goes on every
 *    item's history (single and bulk);
 *  - PriceDialog: send or update the client price;
 *  - LinkJobDialog: put the item on a job at the same property (the existing
 *    attach, which also adds the job task);
 *  - EditDetailsDialog: title, area, category, action, priority, estimate,
 *    description and whether the client sees it.
 *
 * Every dialog freezes its fields while saving, keeps what was typed when the
 * save fails (with the server's reason), and resets when it opens for a
 * different item.
 */
import * as React from "react";
import {
  MaintenanceAction,
  MaintenanceCategory,
  MaintenancePriority,
} from "@prisma/client";
import { EButton } from "@/components/v2/ui/primitives";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { EField, EInput, ESelect, ESwitch, ETextarea } from "@/components/v2/admin/estate-kit";
import { ACTION_LABELS, CATEGORY_LABELS, PRIORITY_LABELS } from "@/lib/maintenance/labels";
import { patchMaintenanceItem } from "./maintenance-api";
import { money, priceState, PRICE_STATE_LABELS } from "./maintenance-format";

const PHONE_INPUT = "max-sm:h-11 max-sm:text-base";

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
      {message}
    </p>
  );
}

// ─── Resolve / dismiss ──────────────────────────────────────────────────────

export type StatusNoteRequest = {
  kind: "RESOLVED" | "DISMISSED";
  /** How many items; 1 shows the title. */
  count: number;
  title: string | null;
  /** A note already typed elsewhere (the side panel's note box). */
  initialNote?: string;
};

export function StatusNoteDialog({
  request,
  onClose,
  onConfirm,
}: {
  request: StatusNoteRequest | null;
  onClose: () => void;
  onConfirm: (note: string | null) => Promise<boolean>;
}) {
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const key = request ? `${request.kind}:${request.count}:${request.title ?? ""}` : "";

  React.useEffect(() => {
    setNote(request?.initialNote ?? "");
    setError(null);
  }, [key, request?.initialNote]);

  if (!request) return null;
  const resolving = request.kind === "RESOLVED";
  const subject = request.count === 1 && request.title ? request.title : `${request.count} items`;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const done = await onConfirm(note.trim() || null);
      if (!done) setError("Nothing was changed. Try again.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nothing was changed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Tier A (board "Confirmations and deletes"): one sentence, an optional note, the button.
  return (
    <EConfirmDialog
      open
      tier="ordinary"
      busy={busy}
      onClose={onClose}
      title={resolving ? `Mark ${subject} resolved?` : `Dismiss ${subject}?`}
      description={
        resolving
          ? "The item closes as resolved. It can be reopened by changing its status again."
          : "The item is dismissed, not deleted: the client and any linked case keep their history, and it can be reopened."
      }
      confirmLabel={resolving ? "Mark resolved" : "Dismiss"}
      error={error}
      onConfirm={() => confirm()}
    >
      <fieldset disabled={busy} className="space-y-2">
        <EField label="Note for the history, optional" hint={request.count > 1 ? "The same note goes on every item's history." : undefined}>
          <ETextarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={4000} className="max-sm:text-base" />
        </EField>
      </fieldset>
    </EConfirmDialog>
  );
}

// ─── Client price ───────────────────────────────────────────────────────────

export type PriceTarget = {
  id: string;
  title: string;
  quotedCost: number | null;
  costApprovalStatus: string | null;
};

export function PriceDialog({ target, onClose, onSaved }: { target: PriceTarget | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [amount, setAmount] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setAmount(target?.quotedCost != null ? target.quotedCost.toFixed(2) : "");
    setError(null);
  }, [target?.id, target?.quotedCost]);

  if (!target) return null;
  const state = priceState(target.costApprovalStatus);

  async function save() {
    if (!target) return;
    const value = Number(amount);
    if (amount.trim() === "" || !Number.isFinite(value) || value < 0) {
      setError("Enter the price in dollars, for example 240.00.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await patchMaintenanceItem(target.id, { quotedCost: value }, "The price could not be sent. Nothing was changed.");
      onSaved(`Price ${money(value)} sent to the client for approval.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The price could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EActionDialog
      open
      busy={busy}
      onClose={onClose}
      eyebrow={target.title}
      title={state === "NOT_SENT" ? "Send a client price" : "Update the client price"}
      description="Sending a price makes the item visible to the client. They approve or decline in their portal; an approved price does not create an invoice by itself."
      footer={
        <>
          <EButton variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </EButton>
          <EButton onClick={() => void save()} disabled={busy}>
            {busy ? "Sending…" : state === "NOT_SENT" ? "Send for approval" : "Update price"}
          </EButton>
        </>
      }
    >
      {state !== "NOT_SENT" ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Now: {money(target.quotedCost) ?? "No amount recorded"} · {PRICE_STATE_LABELS[state]}. Updating asks the client again.
        </p>
      ) : null}
      <fieldset disabled={busy}>
        <EField label="Amount (AUD)">
          <EInput type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className={PHONE_INPUT} />
        </EField>
      </fieldset>
      <ErrorLine message={error} />
    </EActionDialog>
  );
}

// ─── Link to a job ──────────────────────────────────────────────────────────

export type LinkJobTarget = { id: string; title: string; propertyId: string; propertyName: string; jobId: string | null };

type JobOption = { id: string; jobNumber: string | null; scheduledDate: string | null; status: string };

/** Jobs that already reached review cannot take new work (the server refuses them too). */
const CLOSED_JOB_STATUSES = new Set(["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED", "CANCELLED"]);

export function LinkJobDialog({ target, onClose, onSaved }: { target: LinkJobTarget | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [jobs, setJobs] = React.useState<JobOption[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [jobId, setJobId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const propertyId = target?.propertyId ?? null;

  React.useEffect(() => {
    setJobId("");
    setError(null);
    setJobs(null);
    setLoadError(null);
    if (!propertyId) return;
    const controller = new AbortController();
    fetch(`/api/jobs?paginated=1&propertyId=${encodeURIComponent(propertyId)}&page=1&limit=50`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { jobs?: JobOption[]; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body || !Array.isArray(body.jobs)) throw new Error(body?.error ?? "The jobs for this property could not be loaded.");
        setJobs(body.jobs.filter((job) => !CLOSED_JOB_STATUSES.has(job.status)));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(cause instanceof Error ? cause.message : "The jobs for this property could not be loaded.");
      });
    return () => controller.abort();
  }, [propertyId, target?.id]);

  if (!target) return null;

  async function save() {
    if (!target || !jobId) {
      setError("Choose a job.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await patchMaintenanceItem(target.id, { attachJobId: jobId }, "The item could not be linked. Nothing was changed.");
      onSaved("Linked to the job. The job now has a task for this repair.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The item could not be linked.");
    } finally {
      setBusy(false);
    }
  }

  function jobLabel(job: JobOption): string {
    const day = job.scheduledDate ? new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(job.scheduledDate)) : "No date";
    return `${job.jobNumber ?? "Job"} · ${day} · ${job.status.replace(/_/g, " ").toLowerCase()}`;
  }

  return (
    <EActionDialog
      open
      busy={busy}
      onClose={onClose}
      eyebrow={target.title}
      title="Link to a job"
      description={`Jobs at ${target.propertyName} that have not been submitted. Linking adds a task to that job so whoever turns up does the repair; a task already on another unstarted job moves with it.`}
      footer={
        <>
          <EButton variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </EButton>
          <EButton onClick={() => void save()} disabled={busy || !jobId}>
            {busy ? "Linking…" : "Link to job"}
          </EButton>
        </>
      }
    >
      {jobs === null && !loadError ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading jobs…</p> : null}
      {loadError ? <ErrorLine message={loadError} /> : null}
      {jobs && jobs.length === 0 ? <p className="text-[0.8125rem]">No open jobs at this property. Book a job first, then link it here.</p> : null}
      {jobs && jobs.length > 0 ? (
        <fieldset disabled={busy}>
          <EField label="Job" hint={target.jobId ? "The item is already linked to a job; choosing another moves it." : undefined}>
            <ESelect value={jobId} onChange={(event) => setJobId(event.target.value)} className={PHONE_INPUT}>
              <option value="">Choose a job</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {jobLabel(job)}
                </option>
              ))}
            </ESelect>
          </EField>
        </fieldset>
      ) : null}
      <ErrorLine message={error} />
    </EActionDialog>
  );
}

// ─── Edit details ───────────────────────────────────────────────────────────

export type EditableItem = {
  id: string;
  title: string;
  area: string | null;
  category: MaintenanceCategory;
  recommendedAction: MaintenanceAction;
  priority: MaintenancePriority;
  estimatedCost: number | null;
  description: string | null;
  clientVisible: boolean;
};

type EditDraft = {
  title: string;
  area: string;
  category: MaintenanceCategory;
  recommendedAction: MaintenanceAction;
  priority: MaintenancePriority;
  estimatedCost: string;
  description: string;
  clientVisible: boolean;
};

function draftFrom(item: EditableItem): EditDraft {
  return {
    title: item.title,
    area: item.area ?? "",
    category: item.category,
    recommendedAction: item.recommendedAction,
    priority: item.priority,
    estimatedCost: item.estimatedCost != null ? item.estimatedCost.toFixed(2) : "",
    description: item.description ?? "",
    clientVisible: item.clientVisible,
  };
}

export function EditDetailsDialog({ item, onClose, onSaved }: { item: EditableItem | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [draft, setDraft] = React.useState<EditDraft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDraft(item ? draftFrom(item) : null);
    setError(null);
  }, [item]);

  if (!item || !draft) return null;
  const set = (patch: Partial<EditDraft>) => setDraft((current) => (current ? { ...current, ...patch } : current));

  async function save() {
    if (!item || !draft) return;
    if (!draft.title.trim()) {
      setError("The item needs a title.");
      return;
    }
    const estimate = draft.estimatedCost.trim() === "" ? null : Number(draft.estimatedCost);
    if (estimate !== null && (!Number.isFinite(estimate) || estimate < 0)) {
      setError("Enter the estimate in dollars, or leave it empty for not estimated.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await patchMaintenanceItem(
        item.id,
        {
          title: draft.title.trim(),
          area: draft.area.trim() || null,
          category: draft.category,
          recommendedAction: draft.recommendedAction,
          priority: draft.priority,
          estimatedCost: estimate,
          description: draft.description.trim() || null,
          clientVisible: draft.clientVisible,
        },
        "The details could not be saved. Your changes are still here.",
      );
      onSaved("Details saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The details could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EActionDialog
      open
      busy={busy}
      onClose={onClose}
      title="Edit details"
      eyebrow={item.title}
      description="Changes are recorded on the item's history. Photos the reporter took are kept as they were."
      footer={
        <>
          <EButton variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </EButton>
          <EButton onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save details"}
          </EButton>
        </>
      }
    >
      <fieldset disabled={busy} className="space-y-3">
        <EField label="Title">
          <EInput value={draft.title} maxLength={180} onChange={(event) => set({ title: event.target.value })} className={PHONE_INPUT} />
        </EField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EField label="Area">
            <EInput value={draft.area} maxLength={120} onChange={(event) => set({ area: event.target.value })} className={PHONE_INPUT} />
          </EField>
          <EField label="Estimate (AUD), internal" hint="Empty means not estimated.">
            <EInput type="number" min={0} step="0.01" inputMode="decimal" value={draft.estimatedCost} onChange={(event) => set({ estimatedCost: event.target.value })} className={PHONE_INPUT} />
          </EField>
          <EField label="Category">
            <ESelect value={draft.category} onChange={(event) => set({ category: event.target.value as MaintenanceCategory })} className={PHONE_INPUT}>
              {Object.values(MaintenanceCategory).map((value) => (
                <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>
              ))}
            </ESelect>
          </EField>
          <EField label="Action">
            <ESelect value={draft.recommendedAction} onChange={(event) => set({ recommendedAction: event.target.value as MaintenanceAction })} className={PHONE_INPUT}>
              {Object.values(MaintenanceAction).map((value) => (
                <option key={value} value={value}>{ACTION_LABELS[value]}</option>
              ))}
            </ESelect>
          </EField>
          <EField label="Priority">
            <ESelect value={draft.priority} onChange={(event) => set({ priority: event.target.value as MaintenancePriority })} className={PHONE_INPUT}>
              {Object.values(MaintenancePriority).map((value) => (
                <option key={value} value={value}>{PRIORITY_LABELS[value]}</option>
              ))}
            </ESelect>
          </EField>
        </div>
        <EField label="What was reported">
          <ETextarea value={draft.description} maxLength={6000} rows={4} onChange={(event) => set({ description: event.target.value })} className="max-sm:text-base" />
        </EField>
        <ESwitch checked={draft.clientVisible} onCheckedChange={(value) => set({ clientVisible: value })} label="The client sees this item" />
      </fieldset>
      <ErrorLine message={error} />
    </EActionDialog>
  );
}
