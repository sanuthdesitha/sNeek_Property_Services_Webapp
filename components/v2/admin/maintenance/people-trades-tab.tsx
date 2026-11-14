"use client";

/**
 * People and trades tab (board "Maintenance"): the maintenance workers that
 * used to exist only inside the assign picker. Add, edit, deactivate or
 * reactivate a worker, and turn an ad hoc worker into a Maintenance portal
 * login (administrators only, as the endpoint requires). Workers are never
 * deleted: a deactivated worker keeps their history and leaves the pickers.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EDataTable, type EDataColumn } from "@/components/v2/ui/data-table";
import { EPill } from "@/components/v2/ui/pill";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EField, EInput, ETextarea } from "@/components/v2/admin/estate-kit";
import { toast } from "@/hooks/use-toast";
import { createWorker, promoteWorker, updateWorker } from "./maintenance-api";
import type { WorkerOption } from "./assign-sheet";
import { dayTime } from "./maintenance-format";

type WorkerDraft = { name: string; phone: string; email: string; trade: string; company: string; notes: string };
const EMPTY_DRAFT: WorkerDraft = { name: "", phone: "", email: "", trade: "", company: "", notes: "" };
const PHONE_INPUT = "max-sm:h-11 max-sm:text-base";

function WorkerDialog({ worker, open, onClose, onSaved }: { worker: WorkerOption | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = React.useState<WorkerDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const key = worker?.id ?? "new";

  React.useEffect(() => {
    setDraft(worker ? { name: worker.name, phone: worker.phone ?? "", email: worker.email ?? "", trade: worker.trade ?? "", company: worker.company ?? "", notes: "" } : EMPTY_DRAFT);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = (patch: Partial<WorkerDraft>) => setDraft((current) => ({ ...current, ...patch }));

  async function save() {
    if (!draft.name.trim()) {
      setError("Enter the worker's name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (worker) {
        await updateWorker(worker.id, {
          name: draft.name.trim(),
          phone: draft.phone.trim() || null,
          email: draft.email.trim() || null,
          trade: draft.trade.trim() || null,
          company: draft.company.trim() || null,
          ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
        });
      } else {
        await createWorker({
          name: draft.name.trim(),
          phone: draft.phone.trim() || undefined,
          email: draft.email.trim() || undefined,
          trade: draft.trade.trim() || undefined,
          company: draft.company.trim() || undefined,
        });
      }
      toast({ title: worker ? "Worker saved" : "Worker added", description: draft.name.trim() });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The worker could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EActionDialog
      open={open}
      busy={busy}
      onClose={onClose}
      title={worker ? `Edit ${worker.name}` : "Add a worker"}
      description={worker ? undefined : "An ad hoc worker has no portal login; an administrator can create one afterwards."}
      footer={
        <>
          <EButton variant="outline" onClick={onClose} disabled={busy}>Cancel</EButton>
          <EButton onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : worker ? "Save worker" : "Add worker"}</EButton>
        </>
      }
    >
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        <EField label="Name"><EInput value={draft.name} maxLength={160} onChange={(event) => set({ name: event.target.value })} className={PHONE_INPUT} /></EField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EField label="Trade"><EInput value={draft.trade} maxLength={80} placeholder="e.g. Plumber" onChange={(event) => set({ trade: event.target.value })} className={PHONE_INPUT} /></EField>
          <EField label="Company"><EInput value={draft.company} maxLength={160} onChange={(event) => set({ company: event.target.value })} className={PHONE_INPUT} /></EField>
          <EField label="Phone"><EInput value={draft.phone} maxLength={40} inputMode="tel" onChange={(event) => set({ phone: event.target.value })} className={PHONE_INPUT} /></EField>
          <EField label="Email" hint="Needed to create a portal login."><EInput value={draft.email} type="email" onChange={(event) => set({ email: event.target.value })} className={PHONE_INPUT} /></EField>
        </div>
        {worker ? (
          <EField label="Notes, replace" hint="Leave empty to keep the current notes.">
            <ETextarea value={draft.notes} maxLength={2000} rows={2} onChange={(event) => set({ notes: event.target.value })} className="max-sm:text-base" />
          </EField>
        ) : null}
      </fieldset>
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
    </EActionDialog>
  );
}

export function PeopleTradesTab({
  workers,
  error,
  isAdmin,
  timeZone,
  onReload,
}: {
  workers: WorkerOption[] | null;
  error: string | null;
  isAdmin: boolean;
  timeZone: string;
  onReload: () => void;
}) {
  const [editing, setEditing] = React.useState<WorkerOption | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function setActive(worker: WorkerOption, isActive: boolean) {
    setBusyId(worker.id);
    try {
      await updateWorker(worker.id, { isActive });
      toast({ title: isActive ? "Worker reactivated" : "Worker deactivated", description: isActive ? worker.name : `${worker.name} leaves the pickers; their history is kept.` });
      onReload();
    } catch (cause) {
      toast({ title: "Not changed", description: cause instanceof Error ? cause.message : "Nothing was changed.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function createLogin(worker: WorkerOption) {
    setBusyId(worker.id);
    try {
      const result = await promoteWorker(worker.id);
      toast({
        title: "Portal login created",
        description: result.invitationEmailSent ? "The invitation email was sent." : result.invitationLink ? "The invitation email did not go out. Copy the link from the worker's account." : "Share the invitation with them yourself.",
      });
      onReload();
    } catch (cause) {
      toast({ title: "No login created", description: cause instanceof Error ? cause.message : "Nothing was changed.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  const columns: Array<EDataColumn<WorkerOption>> = [
    { key: "name", header: "Name", cell: (worker) => <b className={worker.isActive ? undefined : "text-[hsl(var(--e-muted-foreground))]"}>{worker.name}{worker.isActive ? "" : " (inactive)"}</b> },
    { key: "trade", header: "Trade · company", cell: (worker) => [worker.trade, worker.company].filter(Boolean).join(" · ") || <span className="text-[hsl(var(--e-muted-foreground))]">Not recorded</span> },
    {
      key: "login",
      header: "Portal login",
      cell: (worker) =>
        worker.userId ? (
          <EPill tone="ok">Has login</EPill>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <EPill>Ad hoc, no login</EPill>
            {isAdmin ? (
              <button type="button" disabled={busyId === worker.id} onClick={() => void createLogin(worker)} className="min-h-8 text-[0.75rem] text-[hsl(var(--e-primary))] underline underline-offset-2 disabled:opacity-50 max-sm:min-h-11">
                Create portal login
              </button>
            ) : null}
          </span>
        ),
    },
    { key: "open", header: "Open items", align: "right", cell: (worker) => <span className="e-tnum">{worker.openItems ?? "–"}</span> },
    { key: "last", header: "Last visit", cell: (worker) => <span className="e-tnum">{dayTime(worker.lastVisitAt ?? null, timeZone) ?? "No visit recorded"}</span> },
    {
      key: "menu",
      header: <span className="sr-only">Actions</span>,
      className: "w-[44px]",
      cell: (worker) => (
        <ERowMenu
          label={`More for ${worker.name}`}
          disabled={busyId === worker.id}
          items={[
            { key: "edit", label: "Edit…", onSelect: () => { setEditing(worker); setDialogOpen(true); } },
            ...(!worker.userId ? [{ key: "login", label: "Create portal login", disabled: !isAdmin || !worker.email, hint: !isAdmin ? "For administrators" : !worker.email ? "Add an email first" : undefined, onSelect: () => void createLogin(worker) }] : []),
            worker.isActive
              ? { key: "deactivate", label: "Deactivate", separated: true, onSelect: () => void setActive(worker, false) }
              : { key: "reactivate", label: "Reactivate", separated: true, onSelect: () => void setActive(worker, true) },
          ]}
        />
      ),
    },
  ];

  return (
    <section aria-labelledby="people-trades-heading" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 id="people-trades-heading" className="text-[1rem] font-[650]">People and trades</h2>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Maintenance workers the office assigns to visits. &ldquo;Create portal login&rdquo; turns an ad hoc worker into a Maintenance account. Trades that also bill us appear in Suppliers.
          </p>
        </div>
        <EButton size="sm" variant="outline" onClick={() => { setEditing(null); setDialogOpen(true); }}>Add a worker</EButton>
      </div>
      <div className="overflow-hidden rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
        <EDataTable<WorkerOption>
          label="Maintenance workers"
          columns={columns}
          rows={workers ?? []}
          rowKey={(worker) => worker.id}
          loading={workers === null && !error}
          error={error}
          onRetry={onReload}
          emptyTitle="No workers yet"
          emptyDescription="Add a worker here or from the assign sheet on any item."
          minWidth="44rem"
        />
      </div>
      <WorkerDialog worker={editing} open={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={() => { setDialogOpen(false); onReload(); }} />
    </section>
  );
}
