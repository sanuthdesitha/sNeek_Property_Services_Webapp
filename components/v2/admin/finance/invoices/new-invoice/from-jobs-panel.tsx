"use client";

/**
 * New invoice → From finished jobs (board "New invoice", 2026-11-14).
 *
 * The selection (client, property, period, bill jobs by, GST) is the old
 * "Generate invoice" dialog's; the request it finally sends is that dialog's
 * request plus a request key, so the existing generator makes the draft.
 * Before anything is created the panel shows what the draft will hold.
 *
 * - Period default: where the client's last invoice ended, else the 1st of
 *   the month (owner default, pending confirmation), until the dates are
 *   edited; a new client starts over.
 * - A job with no rate blocks the draft, as the generator does, with its two
 *   fixes in place. Per the owner default (pending confirmation) the office
 *   may instead leave the named jobs off; they are listed on the draft as
 *   "not billed: no rate".
 * - Create draft is idempotent: one request key per selection, kept for a
 *   retry after a failure or a lost answer. Every field and fix is frozen
 *   while it runs; a failure keeps the selection.
 * - The batch "Create N drafts" for all clients stays beside it.
 */
import * as React from "react";
import Link from "next/link";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EToneCard } from "@/components/v2/ui/tone-band";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { E_INPUT_CLASS } from "@/components/v2/admin/estate-kit";
import { cn } from "@/lib/utils";
import type { GeneratePreview, GenerateRequestResponse } from "@/lib/billing/client-invoice-generate-preview-types";
import type { InvoiceFormContext } from "../invoice-model";
import { invoiceEditorPath } from "../invoice-links";
import { BatchDraftsDialog } from "../batch-drafts-dialog";
import { JobsPreviewCard } from "./jobs-preview";
import { formatMoney, jobLabel, newRequestKey, periodText } from "./new-invoice-format";
import { useGeneratePreview, usePeriodDefault, useReadyToBillSummary, type JobsSelection } from "./use-new-invoice-data";

type CreateState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "failed"; message: string }
  | { status: "done"; draft: GenerateRequestResponse; clientName: string };

const FIELD_CLASS = cn(E_INPUT_CLASS, "max-sm:h-11 max-sm:text-[16px]");

function emptySelection(clientId: string): JobsSelection {
  return { clientId, propertyId: "", periodStart: "", periodEnd: "", periodBasis: "SCHEDULED", gstEnabled: true };
}

function fingerprint(selection: JobsSelection, leaveOut: readonly string[]): string {
  return JSON.stringify([selection, [...leaveOut].sort()]);
}

/** The request key for this exact selection, kept across retries and renewed when anything changes. */
function useRequestKey(print: string): string {
  const ref = React.useRef<{ print: string; key: string } | null>(null);
  if (!ref.current || ref.current.print !== print) ref.current = { print, key: newRequestKey("generate") };
  return ref.current.key;
}

function SelectionCard({
  context,
  selection,
  periodNote,
  onChange,
  onClient,
  onPeriod,
}: {
  context: InvoiceFormContext;
  selection: JobsSelection;
  periodNote: React.ReactNode;
  onChange: (patch: Partial<JobsSelection>) => void;
  onClient: (clientId: string) => void;
  onPeriod: (patch: Pick<Partial<JobsSelection>, "periodStart" | "periodEnd">) => void;
}) {
  const properties = context.properties.filter((property) => property.clientId === selection.clientId);
  const ids = { client: "ni-client", property: "ni-property", from: "ni-from", to: "ni-to", basis: "ni-basis", gst: "ni-gst" };
  return (
    <ECard className="p-3.5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 min-[1400px]:grid-cols-4">
        <div className="min-w-0 space-y-1.5">
          <label htmlFor={ids.client} className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Client</label>
          <select id={ids.client} className={FIELD_CLASS} value={selection.clientId} onChange={(event) => onClient(event.target.value)}>
            <option value="">Choose a client</option>
            {context.clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
        </div>
        <div className="min-w-0 space-y-1.5">
          <label htmlFor={ids.property} className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Property</label>
          <select id={ids.property} className={FIELD_CLASS} value={selection.propertyId} disabled={!selection.clientId} onChange={(event) => onChange({ propertyId: event.target.value })}>
            <option value="">{selection.clientId ? `All ${properties.length} propert${properties.length === 1 ? "y" : "ies"}` : "All properties"}</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>{property.name}{property.suburb ? ` — ${property.suburb}` : ""}</option>
            ))}
          </select>
        </div>
        <fieldset className="min-w-0 space-y-1.5">
          <legend className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Period</legend>
          <div className="grid grid-cols-2 gap-1.5">
            <label htmlFor={ids.from} className="sr-only">Period from</label>
            <input id={ids.from} type="date" className={FIELD_CLASS} value={selection.periodStart} max={selection.periodEnd || undefined} disabled={!selection.clientId} onChange={(event) => onPeriod({ periodStart: event.target.value })} />
            <label htmlFor={ids.to} className="sr-only">Period to</label>
            <input id={ids.to} type="date" className={FIELD_CLASS} value={selection.periodEnd} min={selection.periodStart || undefined} disabled={!selection.clientId} onChange={(event) => onPeriod({ periodEnd: event.target.value })} />
          </div>
          <p className="text-[0.71875rem] text-[hsl(var(--e-muted-foreground))]">{periodNote}</p>
        </fieldset>
        <div className="min-w-0 space-y-1.5">
          <label htmlFor={ids.basis} className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Bill jobs by</label>
          <select id={ids.basis} className={FIELD_CLASS} value={selection.periodBasis} onChange={(event) => onChange({ periodBasis: event.target.value === "SERVICE" ? "SERVICE" : "SCHEDULED" })}>
            <option value="SCHEDULED">Scheduled date</option>
            <option value="SERVICE">Completion date</option>
          </select>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-1 text-[0.8125rem]">
        <label htmlFor={ids.gst} className="flex min-h-8 items-center gap-2 font-[500] max-sm:min-h-11">
          <input id={ids.gst} type="checkbox" checked={selection.gstEnabled} onChange={(event) => onChange({ gstEnabled: event.target.checked })} className="h-4 w-4 accent-[hsl(var(--e-primary))]" />
          Include GST (10%)
        </label>
        <p className="min-w-0 flex-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
          Scheduled date matches the date printed on each line. Completion date uses the scheduled date for unfinished work.
          {selection.periodBasis === "SERVICE" ? " A job scheduled before the period but finished inside it is included and its line shows that earlier date." : ""}
        </p>
      </div>
    </ECard>
  );
}

function CreateCard({
  preview,
  ready,
  canManage,
  create,
  leaveOut,
  onLeaveOut,
  onCreate,
}: {
  preview: GeneratePreview | null;
  ready: boolean;
  canManage: boolean;
  create: CreateState;
  leaveOut: boolean;
  onLeaveOut: (value: boolean) => void;
  onCreate: () => void;
}) {
  const saving = create.status === "saving";
  const unrated = preview ? preview.jobs.filter((job) => job.source === "MISSING") : [];
  const names = unrated.map(jobLabel).join(", ");
  const blocked = unrated.length > 0 && !leaveOut;
  const nothing = preview !== null && preview.lineCount === 0;
  const canCreate = canManage && ready && preview !== null && !blocked && !nothing && !saving;
  const tone = !preview || !ready ? null : blocked ? "problem" : unrated.length > 0 ? "attention" : null;
  const title = blocked ? "Cannot create yet" : unrated.length > 0 ? "Ready, with jobs left off" : "Create the draft";
  const sub = blocked ? "The generator refuses a client with an unrated job" : unrated.length > 0 ? `${names} will not be billed` : "Nothing is sent or approved from here";
  const pill = blocked ? `${unrated.length} job${unrated.length === 1 ? "" : "s"} without a rate` : unrated.length > 0 ? "Not billed: no rate" : undefined;
  const lines = preview ? preview.lineCount : 0;
  return (
    <EToneCard
      tone={tone}
      pill={pill}
      header={(
        <>
          <h2 className="text-[0.9375rem] font-[650]">{title}</h2>
          <p className="text-[0.75rem] opacity-80">{sub}</p>
        </>
      )}
    >
      <div className="space-y-2.5 text-[0.8125rem]">
        {unrated.length > 0 ? (
          <>
            <p>
              Set a rate or a fixed price for <b className="font-[600]">{names}</b>, and the preview updates. Nothing is assumed: an unrated job is never billed at $0.
            </p>
            <label className="flex min-h-8 items-start gap-2 max-sm:min-h-11">
              <input type="checkbox" checked={leaveOut} disabled={saving || !canManage} onChange={(event) => onLeaveOut(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--e-primary))]" />
              <span>
                Create without {names}: leave {unrated.length === 1 ? "it" : "them"} unbilled and list {unrated.length === 1 ? "it" : "them"} on the draft as &ldquo;not billed: no rate&rdquo;.
              </span>
            </label>
          </>
        ) : null}
        {!canManage ? <p className="text-[hsl(var(--e-text-secondary))]">Your access to invoices is view only, so you can preview but not create a draft.</p> : null}
        <EButton type="button" className="w-full max-sm:hidden" disabled={!canCreate} onClick={onCreate}>
          {saving ? "Creating the draft…" : create.status === "failed" ? "Try again" : "Create draft"}
        </EButton>
        {create.status === "failed" ? (
          <p role="alert" className="text-[hsl(var(--e-danger))] [overflow-wrap:anywhere]">It was not created: {create.message}</p>
        ) : null}
        <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
          {preview && lines > 0
            ? `${blocked ? "Once possible: one" : "One"} draft for ${preview.client.name}, ${lines} line${lines === 1 ? "" : "s"}, not sent. `
            : nothing && ready ? "There is nothing to put on a draft for this selection. " : ""}
          Its request key is kept, so a retry after a lost answer does not make a second draft.
        </p>
      </div>
    </EToneCard>
  );
}

function DraftMadeCard({ draft, clientName, onNew }: { draft: GenerateRequestResponse; clientName: string; onNew: () => void }) {
  return (
    <EToneCard
      tone="good"
      pill="Draft, not sent"
      role="status"
      header={(
        <>
          <h2 className="text-[0.9375rem] font-[650]">Draft made</h2>
          <p className="text-[0.75rem] opacity-80">Then the invoice editor opens</p>
        </>
      )}
    >
      <div className="space-y-2.5 text-[0.8125rem]">
        <p>
          <b className="font-[600]">{draft.invoiceNumber}</b> draft for {clientName} · {draft.lineCount} line{draft.lineCount === 1 ? "" : "s"} · {formatMoney(draft.totalAmount)} incl. GST. Not sent, not in Xero.
          {draft.replayed ? " (This draft was made by the earlier request; nothing new was created.)" : ""}
        </p>
        {draft.notBilled.length > 0 ? <p>Not billed: no rate — {draft.notBilled.map(jobLabel).join(", ")}. Listed on the draft.</p> : null}
        <div className="flex flex-wrap gap-2">
          <EButton asChild size="sm"><Link href={invoiceEditorPath(draft.id)}>Open {draft.invoiceNumber}</Link></EButton>
          <EButton type="button" size="sm" variant="outline" onClick={onNew}>New invoice</EButton>
        </div>
      </div>
    </EToneCard>
  );
}

function ReadyToBillCard({ reloadToken, canManage, onDone }: { reloadToken: number; canManage: boolean; onDone: () => void }) {
  const ready = useReadyToBillSummary(reloadToken);
  const [open, setOpen] = React.useState(false);
  const summary = ready.status === "ready" ? ready.summary : null;
  const billable = summary ? summary.clients - summary.blockedClients : 0;
  return (
    <ECard className="p-3.5" role="region" aria-labelledby="ni-ready-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="ni-ready-title" className="text-[0.9375rem] font-[650]">Ready to bill, all clients</h2>
        <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">finished, not invoiced</span>
      </div>
      {ready.status === "loading" ? <p role="status" className="mt-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Loading the clients with unbilled work…</p> : null}
      {ready.status === "error" ? <p role="alert" className="mt-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">{ready.message}</p> : null}
      {summary ? (
        <>
          <dl className="mt-2 text-[0.8125rem]">
            {[
              ["Clients with finished work", String(summary.clients)],
              ["Jobs", String(summary.jobs)],
              ["Charged jobs, ex GST", formatMoney(summary.total)],
              ["Blocked by a missing rate", `${summary.blockedClients} client${summary.blockedClients === 1 ? "" : "s"}`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2 border-t border-[hsl(var(--e-border))] py-1.5 first:border-t-0">
                <dt className="text-[hsl(var(--e-text-secondary))]">{label}</dt>
                <dd className="e-tnum font-[600]">{value}</dd>
              </div>
            ))}
          </dl>
          <EButton type="button" variant="outline" className="mt-2 w-full" disabled={!canManage || billable === 0} onClick={() => setOpen(true)} aria-haspopup="dialog">
            Create {billable} draft{billable === 1 ? "" : "s"}…
          </EButton>
          <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">The existing batch: one draft per client that can be billed, each client&rsquo;s outcome listed.</p>
        </>
      ) : null}
      {open ? <BatchDraftsDialog onClose={() => setOpen(false)} onDone={onDone} /> : null}
    </ECard>
  );
}

export function FromJobsPanel({ context, canManage, initialClientId, timeZone }: { context: InvoiceFormContext; canManage: boolean; initialClientId: string; timeZone: string }) {
  const [selection, setSelection] = React.useState<JobsSelection>(() => emptySelection(initialClientId));
  const [periodTouched, setPeriodTouched] = React.useState(false);
  const [reloadToken, setReloadToken] = React.useState(0);
  const [readyToken, setReadyToken] = React.useState(0);
  const [leaveOut, setLeaveOut] = React.useState(false);
  const [create, setCreate] = React.useState<CreateState>({ status: "idle" });
  const period = usePeriodDefault(selection.clientId);

  // Fill the period from the client's default until the office edits it.
  React.useEffect(() => {
    if (period.status !== "ready" || periodTouched || period.clientId !== selection.clientId) return;
    setSelection((current) => (current.clientId === period.clientId ? { ...current, periodStart: period.period.start, periodEnd: period.period.end } : current));
  }, [period, periodTouched, selection.clientId]);

  const periodSettled = periodTouched || period.status === "ready" || period.status === "error";
  const periodInvalid = Boolean(selection.periodStart && selection.periodEnd && selection.periodStart > selection.periodEnd);
  const previewSelection = selection.clientId && periodSettled && !periodInvalid && create.status !== "done" ? selection : null;
  const state = useGeneratePreview(previewSelection, reloadToken);
  const preview = state.status === "ready" ? state.preview : null;
  const unratedIds = preview?.unratedJobIds ?? [];
  const leaveOutIds = leaveOut ? unratedIds : [];
  const requestKey = useRequestKey(fingerprint(selection, leaveOutIds));
  const saving = create.status === "saving";
  const clientName = context.clients.find((client) => client.id === selection.clientId)?.name ?? "the client";

  function change(patch: Partial<JobsSelection>) {
    setSelection((current) => ({ ...current, ...patch }));
    setLeaveOut(false);
    if (create.status === "failed") setCreate({ status: "idle" });
  }

  function chooseClient(clientId: string) {
    setSelection(emptySelection(clientId));
    setPeriodTouched(false);
    setLeaveOut(false);
    setCreate({ status: "idle" });
  }

  function choosePeriod(patch: Pick<Partial<JobsSelection>, "periodStart" | "periodEnd">) {
    setPeriodTouched(true);
    change(patch);
  }

  // A second click before React re-renders must not send a second request.
  const inFlight = React.useRef(false);

  async function submit() {
    if (!preview || saving || inFlight.current) return;
    inFlight.current = true;
    setCreate({ status: "saving" });
    try {
      const response = await fetch("/api/admin/invoices/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestKey,
          clientId: selection.clientId,
          propertyId: selection.propertyId || null,
          periodStart: selection.periodStart || null,
          periodEnd: selection.periodEnd || null,
          periodBasis: selection.periodBasis,
          gstEnabled: selection.gstEnabled,
          leaveOutUnratedJobIds: leaveOutIds,
        }),
      });
      const body = (await response.json().catch(() => null)) as (GenerateRequestResponse & { error?: string }) | null;
      if (!response.ok || !body?.id) {
        setCreate({ status: "failed", message: body?.error ?? "The draft could not be created." });
        setReloadToken((token) => token + 1);
        return;
      }
      setCreate({ status: "done", draft: body, clientName });
      setReadyToken((token) => token + 1);
    } catch {
      // The same key is sent again on retry, so a lost answer never makes a second draft.
      setCreate({ status: "failed", message: "No answer from the server. Try again: the same request is sent, so it cannot make a second draft." });
    } finally {
      inFlight.current = false;
    }
  }

  function startOver() {
    setSelection(emptySelection(""));
    setPeriodTouched(false);
    setLeaveOut(false);
    setCreate({ status: "idle" });
  }

  const periodNote: React.ReactNode = !selection.clientId
    ? "Starts where the client's last invoice ended."
    : periodInvalid
      ? <span role="alert" className="text-[hsl(var(--e-danger))]">The start must be on or before the end.</span>
      : period.status === "loading" && !periodTouched
        ? "Working out the usual period…"
        : period.status === "error" && !periodTouched
          ? period.message
          : selection.periodStart && selection.periodEnd
            ? `${periodText(selection.periodStart, selection.periodEnd)}${!periodTouched && period.status === "ready" ? (period.period.source === "LAST_INVOICE" ? ` · after ${period.period.lastInvoiceNumber ?? "the last invoice"}` : " · from the 1st of the month") : ""}`
            : "No dates: every unbilled job of this client.";

  const done = create.status === "done" ? create : null;

  return (
    <div className="flex min-w-0 flex-col gap-3.5 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {done ? null : (
          <fieldset disabled={saving} className="min-w-0 space-y-3">
            <legend className="sr-only">What to bill</legend>
            <SelectionCard context={context} selection={selection} periodNote={periodNote} onChange={change} onClient={chooseClient} onPeriod={choosePeriod} />
          </fieldset>
        )}
        {done ? null : (
          <JobsPreviewCard state={state} timeZone={timeZone} frozen={saving || !canManage} onFixed={() => setReloadToken((token) => token + 1)} onRetry={() => setReloadToken((token) => token + 1)} />
        )}
      </div>
      <aside aria-label="Create the draft" className="flex min-w-0 flex-col gap-3 lg:w-[340px] lg:shrink-0">
        {done ? (
          <DraftMadeCard draft={done.draft} clientName={done.clientName} onNew={startOver} />
        ) : selection.clientId ? (
          <CreateCard preview={preview} ready={state.status === "ready"} canManage={canManage} create={create} leaveOut={leaveOut} onLeaveOut={setLeaveOut} onCreate={() => void submit()} />
        ) : null}
        <ReadyToBillCard reloadToken={readyToken} canManage={canManage} onDone={() => setReadyToken((token) => token + 1)} />
      </aside>
      {!done && selection.clientId ? (
        <EPhoneActionBar
          label="New invoice actions"
          primary={(
            <EButton type="button" disabled={!canManage || !preview || saving || preview.lineCount === 0 || (unratedIds.length > 0 && !leaveOut)} onClick={() => void submit()}>
              {saving ? "Creating the draft…" : create.status === "failed" ? "Try again" : "Create draft"}
            </EButton>
          )}
        />
      ) : null}
    </div>
  );
}
