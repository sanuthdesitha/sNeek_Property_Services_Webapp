"use client";

/**
 * The shopping run page (board "Shopping run", 2026-11-17). It reads top to
 * bottom as the office works it: what is waiting (the reimbursement band and
 * its approval, the page's main action while it waits), what was bought (the
 * item lines, costs as entered, "Not entered" when missing), who pays (charges
 * to clients) and the proof in the rail (payment and receipts, reimbursement
 * statuses and PDFs, purchase order, history). Run status is a correction, so
 * it sits in More. Every save re-reads the run on the server.
 *
 * Same endpoints as before:
 *   PATCH /api/admin/inventory/shopping-runs/[id]                 status, payment, statuses, approval note
 *   POST  /api/admin/inventory/shopping-runs/[id]/deposit-on-hand add bought items to stock on hand
 *   GET   /api/admin/inventory/shopping-runs/[id]/po              purchase order PDF
 *   GET   /api/admin/inventory/shopping-runs/[id]/reimbursement   reimbursement PDF per client
 *   POST  /api/uploads/direct                                      receipt upload
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { EToneCard, EToneNotice, toneMutedClass } from "@/components/v2/ui/tone-band";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { describeMissingCosts } from "@/lib/inventory/shopping-line-cost";
import type { ShoppingRunPageData } from "@/lib/inventory/shopping-run-page";
import type { SensitiveCredentialsInput } from "@/lib/security/pin-rules";
import { aud, plural, stamp } from "../../pay-records/format";
import { FactTiles, HistoryList, MUTED, RailCard, SMALL } from "../../pay-records/record-parts";
import { sendJson } from "../../pay-records/send-json";
import { ShoppingClientCharges } from "../shopping-client-charges";
import { ShoppingRunDialogs, type ShoppingDialog } from "./shopping-run-dialogs";
import { ShoppingItemsPhone, ShoppingItemsTable, coverageText, listedLines } from "./shopping-run-items";
import {
  CLIENT_CHARGE_LABEL,
  CLIENT_CHARGE_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  REIMBURSEMENT_LABEL,
  REIMBURSEMENT_STATUSES,
  RUN_STATUSES,
  RUN_STATUS_LABEL,
  SHOPPING_RUNS_BACK,
  firstName,
  isCleanerPaid,
  type ShoppingRunView,
} from "./shopping-run-model";

type Attachment = ShoppingRunView["payment"]["receipts"][number];
type PhoneTab = "summary" | "items" | "receipts";
type Outcome = { ok: true } | { ok: false; error: string };
type FailedStatus = { status: ShoppingRunView["status"]; error: string } | null;

const PAYABLE_TARGETS = new Set(["READY", "INVOICED", "REIMBURSED"]);

function subtitle(run: ShoppingRunView, timezone: string): string {
  const properties = new Set(run.rows.map((row) => row.propertyId)).size;
  const clients = run.clientAllocations.filter((allocation) => allocation.clientId).length;
  const payer = run.paidByDisplay && !/^[A-Z_ ]+$/.test(run.paidByDisplay) ? run.paidByDisplay : run.ownerName;
  const method = PAYMENT_METHOD_LABEL[run.payment.method] ?? run.payment.method;
  return [
    run.ownerScope === "CLEANER" ? "Cleaner run" : "Client run",
    `bought by ${payer} · ${method.toLowerCase()}`,
    `${plural(properties, "property", "properties")}, ${plural(clients, "client")}`,
    run.dates.startedAt ? `started ${stamp(run.dates.startedAt, timezone)}` : `created ${stamp(run.dates.createdAt, timezone)}`,
  ].join(" · ");
}

function ReimbursementBand({ data, onApprove, disabled }: { data: ShoppingRunPageData; onApprove: () => void; disabled: boolean }) {
  const { run, coverage, approval, timezone } = data;
  const owner = firstName(run.ownerName);
  if (!isCleanerPaid(run)) {
    return <EToneNotice tone="info" title={`Paid on the ${(PAYMENT_METHOD_LABEL[run.payment.method] ?? run.payment.method).toLowerCase()}`}>Nothing is owed to a cleaner for this run.</EToneNotice>;
  }
  const status = run.cleanerReimbursementStatus;
  if (status === "PENDING_APPROVAL") {
    const missing = describeMissingCosts(coverage);
    return (
      <EToneCard
        tone="attention"
        aria-label="Reimbursement waiting"
        header={
          <div>
            <b>{owner} has claimed {aud(run.totals.reimbursableCleanerAmount)} for this run</b>
            <p className={cn("text-[0.75rem]", toneMutedClass("attention"))}>Nothing is paid to {owner} or put on an invoice until the office approves it. Administrators and operations managers can approve.</p>
          </div>
        }
        pill="Waiting for approval"
      >
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            {missing ? <p className={SMALL}><b>Not in the amount:</b> {missing} {coverage.missing.length === 1 ? "was" : "were"} bought but no cost was entered, so {coverage.missing.length === 1 ? "it is" : "they are"} left out rather than counted as $0.</p> : null}
            {run.payment.receipts.length === 0 ? <p className={SMALL}><b>No receipt is attached.</b> Approving asks why it can be approved without one, and keeps your note in the history.</p> : null}
            <p className={cn("text-[0.75rem]", MUTED)}>Approving sets the reimbursement to &quot;Approved, payable&quot;; it then goes on {owner}&apos;s next cleaner invoice or pay run. The amount is what was recorded, never the client charge.</p>
          </div>
          <EButton size="sm" disabled={disabled} onClick={onApprove}>Approve reimbursement…</EButton>
        </div>
      </EToneCard>
    );
  }
  if (status === "NOT_APPLICABLE") return null;
  const approvedLine = approval ? `Approved by ${approval.by ?? "someone not recorded"}, ${stamp(approval.at, timezone)}.` : "Approved before approvals were recorded.";
  return (
    <EToneCard tone="good" aria-label="Reimbursement" header={<b>{REIMBURSEMENT_LABEL[status]} · {aud(run.totals.reimbursableCleanerAmount)}</b>} pill={REIMBURSEMENT_LABEL[status]}>
      <p className={SMALL}>
        {approvedLine}
        {approval?.receiptOverrideNote ? ` Approved without a receipt: "${approval.receiptOverrideNote}".` : ""}
        {status === "READY" ? ` It goes on ${owner}'s next cleaner invoice or pay run.` : ""}
      </p>
    </EToneCard>
  );
}

function ReceiptRow({ receipt, onRemove, disabled }: { receipt: Attachment; onRemove: () => void; disabled: boolean }) {
  return (
    <li className="flex items-center gap-2.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-2.5 py-2">
      <span aria-hidden className="h-9 w-7 shrink-0 rounded-[4px] bg-[hsl(var(--e-surface-raised))]" />
      <div className="min-w-0 flex-1">
        <a href={receipt.url} target="_blank" rel="noopener noreferrer" className="block truncate font-[600] underline-offset-2 hover:underline">{receipt.name}</a>
        <p className={cn("text-[0.75rem]", MUTED)}>amount not recorded</p>
      </div>
      <EButton size="sm" variant="ghost" aria-label={`Remove receipt ${receipt.name}`} disabled={disabled} onClick={onRemove}>✕</EButton>
    </li>
  );
}

export function ShoppingRunPage({ data }: { data: ShoppingRunPageData }) {
  const router = useRouter();
  const { toast } = useToast();
  const { run, coverage, timezone } = data;
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [dialog, setDialog] = React.useState<ShoppingDialog>(null);
  const [dialogError, setDialogError] = React.useState<string | null>(null);
  const [failedStatus, setFailedStatus] = React.useState<FailedStatus>(null);
  const [phoneTab, setPhoneTab] = React.useState<PhoneTab>("summary");
  const [poSupplier, setPoSupplier] = React.useState("");
  const [poRef, setPoRef] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const owner = firstName(run.ownerName);
  const receipts = run.payment.receipts;
  const pending = isCleanerPaid(run) && run.cleanerReimbursementStatus === "PENDING_APPROVAL";
  const frozen = saving || uploading || Boolean(dialog);
  const url = `/api/admin/inventory/shopping-runs/${run.id}`;
  const listed = listedLines(data.lines);
  const boughtCount = listed.filter((line) => line.purchased).length;

  const patch = React.useCallback(async (body: Record<string, unknown>): Promise<Outcome> => {
    setSaving(true);
    try {
      const result = await sendJson(url, "PATCH", body);
      if (!result.ok) return { ok: false, error: result.error };
      router.refresh();
      return { ok: true };
    } finally {
      setSaving(false);
    }
  }, [router, url]);

  async function saveField(body: Record<string, unknown>, done: string) {
    const outcome = await patch(body);
    if (outcome.ok) toast({ title: done });
    else toast({ title: "The change was not saved", description: outcome.error, variant: "destructive" });
  }

  async function changeRunStatus(status: ShoppingRunView["status"]) {
    setFailedStatus(null);
    const outcome = await patch({ status });
    if (outcome.ok) toast({ title: `Run set to ${RUN_STATUS_LABEL[status]}` });
    else setFailedStatus({ status, error: outcome.error });
  }

  async function uploadReceipts(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: Attachment[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("folder", "shopping-receipts");
        const response = await fetch("/api/uploads/direct", { method: "POST", body: form });
        const body = (await response.json().catch(() => ({}))) as { key?: string; url?: string; error?: string };
        if (!response.ok || !body.key || !body.url) throw new Error(body.error ?? `Could not upload ${file.name}.`);
        uploaded.push({ key: body.key, url: body.url, name: file.name, mimeType: file.type || undefined, sizeBytes: file.size || undefined });
      }
      await saveField({ payment: { ...run.payment, receipts: [...receipts, ...uploaded] } }, "Receipts uploaded");
    } catch (error) {
      toast({ title: "Upload failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function guarded(work: () => Promise<Outcome>, done: string): Promise<Outcome> {
    setDialogError(null);
    const outcome = await work();
    if (outcome.ok) {
      setDialog(null);
      toast({ title: done });
    } else {
      setDialogError(outcome.error);
    }
    return outcome;
  }

  const onApprove = (target: "READY" | "INVOICED" | "REIMBURSED", overrideNote: string | null) =>
    guarded(() => patch({ cleanerReimbursementStatus: target, ...(overrideNote ? { approvalOverrideNote: overrideNote } : {}) }), "Reimbursement approved");

  const onAddStock = () =>
    guarded(async () => {
      setSaving(true);
      try {
        const result = await sendJson<{ duplicated?: boolean; count?: number }>(`${url}/deposit-on-hand`, "POST");
        if (!result.ok) return { ok: false, error: result.error };
        if (result.data.duplicated) toast({ title: "Already in stock on hand", description: "Nothing was added twice." });
        router.refresh();
        return { ok: true };
      } finally {
        setSaving(false);
      }
    }, "Bought items added to stock on hand");

  const onRemoveReceipt = (key: string, credentials: SensitiveCredentialsInput | undefined) =>
    guarded(() => patch({ payment: { ...run.payment, receipts: receipts.filter((receipt) => receipt.key !== key) }, security: credentials ?? {} }), "Receipt removed");

  const openDialog = (next: ShoppingDialog) => {
    setDialogError(null);
    setDialog(next);
  };

  const poHref = () => {
    const query = new URLSearchParams();
    if (poSupplier.trim()) query.set("supplier", poSupplier.trim());
    if (poRef.trim()) query.set("orderReference", poRef.trim());
    const text = query.toString();
    return `${url}/po${text ? `?${text}` : ""}`;
  };
  const reimbursementHref = (clientId: string | null) => `${url}/reimbursement${clientId ? `?clientId=${clientId}` : ""}`;

  const stockAction = run.status === "COMPLETED" || run.dates.submittedAt ? !data.stockPosted : false;
  const moreItems: ERowMenuItem[] = [
    ...RUN_STATUSES.map((status, index) => ({
      key: `status-${status}`,
      label: status === run.status ? `${RUN_STATUS_LABEL[status]} (now)` : RUN_STATUS_LABEL[status],
      heading: index === 0 ? "Run status" : undefined,
      disabled: status === run.status,
      onSelect: () => void changeRunStatus(status),
    })),
    data.stockPosted
      ? { key: "stock", label: "Bought items are in stock on hand", heading: "Stock", separated: true, disabled: true, hint: "Running it again adds nothing twice." }
      : { key: "stock", label: "Add bought items to stock on hand…", heading: "Stock", separated: true, disabled: !stockAction, hint: stockAction ? undefined : "Complete the run first.", onSelect: () => openDialog({ kind: "stock" }) },
  ];

  const primary = pending ? (
    <EButton size="sm" disabled={frozen} onClick={() => openDialog({ kind: "approve", target: "READY" })}>Approve reimbursement…</EButton>
  ) : (
    <EButton asChild size="sm"><a href={poHref()} target="_blank" rel="noopener noreferrer">Download purchase order</a></EButton>
  );
  const phonePrimary = pending ? (
    <EButton className="h-11 w-full" disabled={frozen} onClick={() => openDialog({ kind: "approve", target: "READY" })}>Approve reimbursement…</EButton>
  ) : stockAction ? (
    <EButton className="h-11 w-full" variant="outline" disabled={frozen} onClick={() => openDialog({ kind: "stock" })}>Add bought items to stock…</EButton>
  ) : null;
  const tab = (name: PhoneTab) => (phoneTab === name ? "" : "max-sm:hidden");

  return (
    <div className="space-y-4">
      <Link href={SHOPPING_RUNS_BACK} className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">← Shopping runs</Link>
      <EPageHeader
        title={
          <>
            {run.name}{" "}
            <EPill tone={run.status === "COMPLETED" ? "ok" : run.status === "IN_PROGRESS" ? "info" : "neutral"} className="align-middle font-sans text-[0.75rem]">{RUN_STATUS_LABEL[run.status]}</EPill>
          </>
        }
        description={subtitle(run, timezone)}
        actions={
          <>
            {pending ? <EButton asChild size="sm" variant="outline" className="max-sm:hidden"><a href={poHref()} target="_blank" rel="noopener noreferrer">Download purchase order</a></EButton> : null}
            <span className="max-sm:hidden">{primary}</span>
            <ERowMenu label="More run actions" trigger="More" triggerVariant="outline" items={moreItems} disabled={frozen} footnote="A run is never deleted from here; its receipts, charges and history stay with it." />
          </>
        }
      />
      {failedStatus ? (
        <EToneNotice tone="problem" title="The change was not saved">
          <p>{failedStatus.error} Your choice, {RUN_STATUS_LABEL[failedStatus.status]}, is kept as a draft.</p>
          <div className="mt-2 flex gap-2">
            <EButton size="sm" disabled={saving} onClick={() => void changeRunStatus(failedStatus.status)}>Try again</EButton>
            <EButton size="sm" variant="ghost" disabled={saving} onClick={() => setFailedStatus(null)}>Discard</EButton>
          </div>
        </EToneNotice>
      ) : null}
      <div role="group" aria-label="Run sections" className="flex gap-1.5 sm:hidden">
        {(["summary", "items", "receipts"] as PhoneTab[]).map((name) => (
          <button key={name} type="button" aria-pressed={phoneTab === name} onClick={() => setPhoneTab(name)} className={cn(E_CHIP_CLASS, "flex-1 justify-center", phoneTab === name && E_CHIP_ON_CLASS)}>
            {name === "summary" ? "Summary" : name === "items" ? `Items ${listed.length}` : `Receipts ${receipts.length}`}
          </button>
        ))}
      </div>
      <div className={cn("space-y-4", tab("summary"))}>
        <FactTiles
          label="Run totals"
          tiles={[
            { key: "lines", label: "Lines on the list", value: listed.length, note: `${boughtCount} bought · ${listed.length - boughtCount} not bought` },
            { key: "estimated", label: "Estimated", value: aud(run.totals.estimatedTotalCost), note: "from usual prices" },
            { key: "actual", label: "Actual", value: aud(run.totals.actualTotalCost), note: coverageText(coverage), noteTone: coverage.costedLines < coverage.boughtLines ? "warning" : undefined },
            isCleanerPaid(run)
              ? { key: "owed", label: `Owed to ${owner}`, value: aud(run.totals.reimbursableCleanerAmount), note: run.cleanerReimbursementStatus === "PENDING_APPROVAL" ? "waiting for office approval" : REIMBURSEMENT_LABEL[run.cleanerReimbursementStatus] }
              : { key: "owed", label: "Owed to a cleaner", value: "Nothing", note: "paid by the business or client" },
            { key: "clients", label: "To charge clients", value: run.totals.reimbursableClientAmount === 0 ? "Nothing" : aud(run.totals.reimbursableClientAmount), note: `client charge: ${CLIENT_CHARGE_LABEL[run.clientChargeStatus].toLowerCase()}` },
          ]}
        />
        <ReimbursementBand data={data} disabled={frozen} onApprove={() => openDialog({ kind: "approve", target: "READY" })} />
      </div>
      <div className="flex min-w-0 flex-col gap-3.5 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-3.5">
          <section aria-labelledby="run-items" className={cn("min-w-0 overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] max-sm:border-0 max-sm:bg-transparent", tab("items"))}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-2 pt-3.5 max-sm:px-0">
              <h2 id="run-items" className="text-[0.9375rem] font-[600]">Items</h2>
              <p className={cn("text-[0.75rem]", MUTED)}>Grouped by property · costs as {owner} entered them</p>
            </div>
            {listed.length ? (
              <>
                <div className="max-sm:hidden"><ShoppingItemsTable lines={data.lines} coverage={coverage} actualTotal={run.totals.actualTotalCost} ownerName={owner} /></div>
                <div className="sm:hidden"><ShoppingItemsPhone lines={data.lines} /></div>
              </>
            ) : (
              <p className={cn("px-4 pb-3", SMALL, MUTED)}>No lines on this run yet.</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] px-4 py-2.5 max-sm:hidden">
              <p className={cn("text-[0.75rem]", MUTED)}>The lines come from the run itself; nothing is recalculated here.</p>
              {data.stockPosted ? (
                <span className={cn(SMALL, MUTED)}>Bought items are in stock on hand.</span>
              ) : (
                <EButton size="sm" variant="outline" disabled={frozen || !stockAction} title={stockAction ? undefined : "Complete the run first."} onClick={() => openDialog({ kind: "stock" })}>Add bought items to stock on hand…</EButton>
              )}
            </div>
          </section>
          <div className={tab("summary")}>
            <ShoppingClientCharges key={run.id} runId={run.id} />
          </div>
        </div>
        <aside aria-label="Payment, receipts and reimbursement" className={cn("flex min-w-0 flex-col gap-3.5 xl:w-[340px] xl:flex-none", tab("receipts"))}>
          <RailCard title="Payment and receipts">
            <EField label="Payment method">
              <ESelect value={run.payment.method} disabled={frozen} onChange={(event) => void saveField({ payment: { ...run.payment, method: event.target.value } }, "Payment updated")}>
                {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{PAYMENT_METHOD_LABEL[method]}</option>)}
              </ESelect>
            </EField>
            <EField label="Paid by">
              <EInput
                defaultValue={run.payment.paidByName ?? ""}
                disabled={frozen}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value !== (run.payment.paidByName ?? "")) void saveField({ payment: { ...run.payment, paidByName: value || null } }, "Payment updated");
                }}
              />
            </EField>
            <EField label="Payment note">
              <EInput
                defaultValue={run.payment.note ?? ""}
                disabled={frozen}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value !== (run.payment.note ?? "")) void saveField({ payment: { ...run.payment, note: value || undefined } }, "Payment updated");
                }}
              />
            </EField>
            {receipts.length ? (
              <ul className="space-y-1.5" aria-label="Receipts">
                {receipts.map((receipt) => (
                  <ReceiptRow key={receipt.key} receipt={receipt} disabled={frozen} onRemove={() => openDialog({ kind: "remove-receipt", key: receipt.key, name: receipt.name })} />
                ))}
              </ul>
            ) : (
              <p className={cn(SMALL, MUTED)}>No receipts uploaded yet.</p>
            )}
            <EButton size="sm" variant="outline" disabled={frozen} onClick={() => fileRef.current?.click()}>{uploading ? "Uploading…" : "Upload receipts"}</EButton>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,.pdf"
              className="hidden"
              onChange={(event) => {
                void uploadReceipts(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            <p className={cn("text-[0.75rem]", MUTED)}>Removing a receipt asks for your PIN: it is the proof behind a reimbursement. The reimbursement PDF is made without it.</p>
          </RailCard>
          <RailCard title="Reimbursement">
            <EField label={`${owner}'s reimbursement`} hint="Corrections only. Approving from here follows the same rule as the band.">
              <ESelect
                value={run.cleanerReimbursementStatus}
                disabled={frozen}
                onChange={(event) => {
                  const next = event.target.value as ShoppingRunView["cleanerReimbursementStatus"];
                  if (run.cleanerReimbursementStatus === "PENDING_APPROVAL" && PAYABLE_TARGETS.has(next)) {
                    openDialog({ kind: "approve", target: next as "READY" | "INVOICED" | "REIMBURSED" });
                    return;
                  }
                  void saveField({ cleanerReimbursementStatus: next }, "Cleaner reimbursement updated");
                }}
              >
                {REIMBURSEMENT_STATUSES.map((status) => <option key={status} value={status}>{REIMBURSEMENT_LABEL[status]}</option>)}
              </ESelect>
            </EField>
            <EField label="Client charge" hint={`Reimbursable from clients: ${aud(run.totals.reimbursableClientAmount)}`}>
              <ESelect value={run.clientChargeStatus} disabled={frozen} onChange={(event) => void saveField({ clientChargeStatus: event.target.value }, "Client charge updated")}>
                {CLIENT_CHARGE_STATUSES.map((status) => <option key={status} value={status}>{CLIENT_CHARGE_LABEL[status]}</option>)}
              </ESelect>
            </EField>
            <ul className="space-y-1.5 border-t border-[hsl(var(--e-border))] pt-2" aria-label="Reimbursement PDFs">
              {(run.clientAllocations.length ? run.clientAllocations : [{ clientId: null, clientName: "All clients", propertyNames: [], lineCount: listed.length, actualAmount: run.totals.actualTotalCost }]).map((allocation, index) => (
                <li key={allocation.clientId ?? `unassigned-${index}`} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <b className="block truncate">{allocation.clientName}</b>
                    <p className={cn("text-[0.75rem]", MUTED)}>{[allocation.propertyNames.join(", "), plural(allocation.lineCount, "line"), aud(allocation.actualAmount)].filter(Boolean).join(" · ")}</p>
                  </div>
                  <EButton asChild size="sm" variant="outline"><a href={reimbursementHref(allocation.clientId)} target="_blank" rel="noopener noreferrer" aria-label={`Reimbursement PDF for ${allocation.clientName}`}>PDF</a></EButton>
                </li>
              ))}
            </ul>
          </RailCard>
          <RailCard title="Purchase order">
            <EField label="Supplier, optional">
              <EInput value={poSupplier} onChange={(event) => setPoSupplier(event.target.value)} placeholder="e.g. Woolworths" />
            </EField>
            <EField label="Order reference, optional">
              <EInput value={poRef} onChange={(event) => setPoRef(event.target.value)} placeholder="e.g. PO-1182" />
            </EField>
            {pending ? <EButton asChild size="sm" variant="outline"><a href={poHref()} target="_blank" rel="noopener noreferrer">Download purchase order</a></EButton> : null}
            <p className={cn("text-[0.75rem]", MUTED)}>A purchase order is a list to buy from. It does not place an order or prove delivery.</p>
          </RailCard>
          <RailCard title="History">
            <HistoryList entries={data.history} timezone={timezone} />
            <p className={cn("text-[0.75rem]", MUTED)}>From the run&apos;s own dates{data.approval ? " and its approval record" : ""}.</p>
          </RailCard>
        </aside>
      </div>
      {phonePrimary ? <EPhoneActionBar label="Shopping run actions" primary={phonePrimary} /> : null}
      <ShoppingRunDialogs
        run={run}
        coverage={coverage}
        dialog={dialog}
        busy={saving}
        error={dialogError}
        onClose={() => setDialog(null)}
        onApprove={onApprove}
        onAddStock={onAddStock}
        onRemoveReceipt={onRemoveReceipt}
      />
    </div>
  );
}
