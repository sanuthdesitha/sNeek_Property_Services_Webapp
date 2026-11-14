"use client";

/**
 * The invoice editor page (/v2/admin/finance/invoices/[id]), replacing the
 * editor modal: header and actions, the stage bar, the lines, and the checks,
 * send, Xero and history cards. Every change goes through the existing invoice
 * routes; see use-invoice-editor.ts for how saving (autosave with a
 * stale-write guard) works.
 *
 * Phones (below 640px, board "Admin phone: Invoice editor"): a thin stage
 * line, the header facts folded to one line with Edit, a section switcher
 * (Lines / Checks / Send / Xero / History), line cards grouped by property
 * with Move up / Move down, an Add line sheet and a total bar whose button
 * follows the stage. See editor-phone.tsx. From 640px up nothing changes.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { ESectionSwitcher } from "@/components/v2/ui/phone-bars";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { EStageBar } from "@/components/v2/ui/stage-bar";
import { clientInvoiceStages } from "@/lib/billing/client-invoice-stage";
import type { ClientInvoiceEditorData, EditorLine } from "@/lib/billing/client-invoice-editor-types";
import { StartedWorkReviewPanel } from "../../started-work-review";
import { InvoiceDialogs, type InvoiceDialog } from "../invoice-dialogs";
import { ACTS_ON_SAVED_INVOICE, availableInvoiceActions, editorPrimaryAction, fmtDay, invoiceActionLabel, type InvoiceActionKey } from "../invoice-model";
import { formatPeriod } from "../invoice-columns";
import { VOID_CREDIT_ACTIONS } from "../invoice-row-actions";
import { EditorLineCards, PhoneHeaderFacts, PhoneLineSheet, PhoneStageLine, PhoneTotalBar, type PhoneLineSheetTarget, type TotalBarAction } from "./editor-phone";
import { isDirectInvoiceAction, runDirectInvoiceAction } from "../invoice-direct-actions";
import { EditorHeader, UNSAVED_ACTION_HINT } from "./editor-header";
import { EditorFields, EditorTotals } from "./editor-fields";
import { EditorLines } from "./editor-lines";
import { EditorChecks } from "./editor-checks";
import { HistoryCard, SendCard, XeroCard, type SendChoices } from "./editor-panels";
import { useXeroRefresh } from "./use-xero-refresh";
import { RegroupLineDialog, RemoveLineDialog, lineCanBeRestored } from "./editor-line-dialogs";
import { undoToast } from "@/components/v2/ui/undo-toast";
import { ClientReferenceField, CreditLinks, EditorFooterActions } from "./editor-extras";
import { lineSections, pdfGroupsLines, propertyGroupedOrder } from "./line-sections";
import { EMPTY_NEW_LINE, validateNewLine } from "./line-drafts";
import { useInvoiceEditor } from "./use-invoice-editor";
import { StatusBanner, saveStateLabel, useNow } from "./editor-banners";
import { useLineSuggestions } from "./use-line-suggestions";
import { AddJobsDialog } from "./add-jobs-dialog";
import { VOID_CREDIT_REFUSAL, addJobsRequest } from "../invoice-requests";

export { saveStateLabel } from "./editor-banners";

const LEAVE_WARNING = "Leave without saving? Your unsaved changes on this invoice will be lost.";

export function InvoiceEditorPage({ initial, backHref }: { initial: ClientInvoiceEditorData; backHref: string }) {
  const router = useRouter();
  const editor = useInvoiceEditor(initial);
  const { state: xeroRefresh, refresh: refreshFromXero } = useXeroRefresh(initial.row.id, editor.reload);
  const { data, drafts, status, saving } = editor;
  const [grouped, setGrouped] = useState(() => pdfGroupsLines(initial.lines));
  const [addingJobs, setAddingJobs] = useState(false);
  const [sendChoices, setSendChoices] = useState<SendChoices>({ includePaymentLink: false, pushToXero: false });
  const [removing, setRemoving] = useState<EditorLine | null>(null);
  const [regrouping, setRegrouping] = useState<EditorLine | null>(null);
  const [dialog, setDialog] = useState<InvoiceDialog>(null);
  const [sendTo, setSendTo] = useState(initial.row.client.email ?? "");
  const [actionBusy, setActionBusy] = useState(false);
  const phone = useIsPhone();
  const [lineSheet, setLineSheet] = useState<PhoneLineSheetTarget | null>(null);
  const [reviewed, setReviewed] = useState(false);

  const row = data.row;
  const editable = data.editLock.editable;
  // Buttons, menus and structural fields wait for any save; typed text stays
  // usable during a background autosave (what is typed then stays a draft).
  const frozen = saving || actionBusy;
  const inputsFrozen = editor.structuralSaving || actionBusy;
  const unsaved = editor.hasUnsavedInput;
  const draftEditable = editable && data.draft !== null;
  const suggestions = useLineSuggestions(row.id, draftEditable, data.updatedAt);
  const now = useNow(editor.lastSavedAt !== null);
  const sections = useMemo(() => lineSections(data.lines, grouped), [data.lines, grouped]);
  const stages = clientInvoiceStages(row);
  const actions = availableInvoiceActions(row);
  const checksToLook = data.checks.items.filter((item) => item.state !== "ok").length;

  // Phones: "Review" leads to the checks once per stage, then the stage's action.
  useEffect(() => {
    setReviewed(false);
  }, [row.status]);

  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = LEAVE_WARNING;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  function addJobs(jobIds: string[]): Promise<boolean> {
    // Not repeatable after a lost answer: the jobs may already be on the invoice.
    return editor.perform("Add finished jobs", (token) => addJobsRequest(row.id, jobIds, token), { repeatable: false });
  }

  /** Undo after removing a plain manual line from a draft: the same charge is added again. */
  function offerLineUndo(line: EditorLine) {
    undoToast({
      title: "Line removed",
      description: line.description,
      onUndo: () => {
        void editor.mutate(
          "Undo remove line",
          { addLine: { description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, category: line.category } },
          { repeatable: false },
        );
      },
    });
  }

  function addLine() {
    const checked = validateNewLine(editor.newLine, data.row.kind);
    if (!checked.ok) {
      editor.setStatus({ kind: "failed", what: "Add line", message: checked.message, retry: null });
      return;
    }
    void editor.mutate("Add line", { addLine: checked.line }, { repeatable: false, onSuccess: () => editor.setNewLine(EMPTY_NEW_LINE) });
  }

  async function reorder(lineIds: string[]) {
    editor.previewOrder(lineIds);
    const saved = await editor.mutate("Line order", { reorderLineIds: lineIds }, { repeatable: true });
    if (!saved) await editor.reload();
  }

  /**
   * Turning "Group by property" on SAVES the grouped line order on an editable
   * invoice through the existing reorder save (restored from the old editor's
   * persistLineOrder). Read-only invoices, and turning it off, change the view only.
   */
  function onGrouped(next: boolean) {
    setGrouped(next);
    if (!next || !editable) return;
    const order = propertyGroupedOrder(data.lines);
    if (order) void reorder(order);
  }

  async function runAction(key: InvoiceActionKey) {
    if (isDirectInvoiceAction(key)) {
      setActionBusy(true);
      try {
        const outcome = await runDirectInvoiceAction(key, row.id);
        toast({ title: outcome.title, description: outcome.description, variant: outcome.ok ? undefined : "destructive" });
        if (outcome.ok) await editor.reload();
      } catch {
        toast({ title: "Could not reach the server", variant: "destructive" });
      } finally {
        setActionBusy(false);
      }
      return;
    }
    if (key === "send" || key === "resend") {
      setDialog({
        kind: "send",
        invoice: row,
        resend: key === "resend",
        to: sendTo,
        options: { includePaymentLink: data.send.paymentLink.available && sendChoices.includePaymentLink, pushToXero: !row.xeroInvoiceId && sendChoices.pushToXero },
      });
      return;
    }
    if (key === "mark-sent" || key === "record-payment" || key === "mark-paid" || key === "receipt" || key === "void" || key === "reverse" || key === "reconcile" || key === "delete" || key === "credit-note") {
      setDialog({ kind: key, invoice: row });
    }
  }

  function onBack(event: React.MouseEvent<HTMLAnchorElement>) {
    if (unsaved && !window.confirm(LEAVE_WARNING)) event.preventDefault();
  }

  const canSend = actions.includes("send") || actions.includes("resend");

  /** Phones: the total bar's button follows the stage: Review, Approve, Send, or the page's primary action. */
  function totalBarAction(): TotalBarAction | null {
    const primary = editorPrimaryAction(row);
    if (!primary) return null;
    if (primary === "approve" && !reviewed) {
      return {
        label: "Review",
        disabled: false,
        onClick: () => {
          setReviewed(true);
          document.getElementById("invoice-checks")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
        },
      };
    }
    const waits = unsaved && ACTS_ON_SAVED_INVOICE.has(primary);
    const refused = VOID_CREDIT_ACTIONS.has(primary) && data.canVoidCredit === false ? VOID_CREDIT_REFUSAL : null;
    return {
      label: invoiceActionLabel(primary, row),
      disabled: frozen || waits || Boolean(refused),
      title: refused ?? (waits ? UNSAVED_ACTION_HINT : undefined),
      onClick: () => void runAction(primary),
    };
  }

  const fieldsSummary = [
    row.client.name,
    formatPeriod(row.periodStart, row.periodEnd),
    row.dueDate ? `due ${fmtDay(row.dueDate)}` : null,
    data.gstEnabled ? "GST 10%" : "no GST",
    grouped ? "grouped by property" : null,
  ].filter((part) => part && part !== "—").join(" · ");
  const addLineFailure = status.kind === "failed" && status.what === "Add line" ? status.message : null;

  return (
    <div className="min-w-0 space-y-3.5">
      <EditorHeader
        invoice={row}
        backHref={backHref}
        saveLabel={saveStateLabel(status, editor.dirtyIds.length > 0, data.updatedAt, data.timezone, { at: editor.lastSavedAt, now })}
        canSave={editor.dirtyIds.length > 0}
        showSave={editable}
        dirty={unsaved}
        busy={frozen}
        onSave={editor.saveNow}
        onDiscard={editor.discardDrafts}
        onBack={onBack}
        onAction={(key) => void runAction(key)}
        voidCreditRefusal={data.canVoidCredit === false ? VOID_CREDIT_REFUSAL : null}
      />
      <CreditLinks data={data} />
      <EStageBar label="Invoice stages" stages={stages.stages} terminal={stages.terminal} className="max-sm:hidden" />
      {phone ? <PhoneStageLine stages={stages.stages} terminal={stages.terminal} /> : null}
      {phone ? <ESectionSwitcher
        label="Invoice sections"
        sections={[
          { id: "invoice-lines", label: "Lines" },
          { id: "invoice-checks", label: checksToLook > 0 ? `Checks · ${checksToLook}` : "Checks" },
          { id: "invoice-send", label: "Send" },
          { id: "invoice-xero", label: "Xero" },
          { id: "invoice-history", label: "History" },
        ]}
      /> : null}
      <StatusBanner status={status} onDismiss={() => editor.setStatus({ kind: "idle" })} onReloadTheirs={() => void editor.reloadTheirs()} />
      {editor.reloadError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-warning)/0.5)] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-warning))]">
          <span className="min-w-0 flex-1">Showing the last copy loaded. It could not be refreshed: {editor.reloadError}</span>
          <EButton type="button" size="sm" variant="outline" onClick={() => void editor.reload()}>
            Reload
          </EButton>
        </div>
      ) : null}
      {!data.editLock.editable ? (
        <p className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          <strong className="font-[600] text-[hsl(var(--e-foreground))]">Read only.</strong> {data.editLock.reason}
        </p>
      ) : null}
      {data.startedWorkUnreadable ? (
        <p role="alert" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger-soft))] px-3 py-2 text-[0.8125rem] font-[550] text-[hsl(var(--e-danger))]">
          {data.startedWorkUnreadable}
        </p>
      ) : null}
      {data.totalsMismatch ? (
        <p role="alert" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger-soft))] px-3 py-2 text-[0.8125rem] font-[550] text-[hsl(var(--e-danger))]">
          This invoice&rsquo;s stored total does not match its lines. Do not send it. Edit any line or the GST switch to recalculate, then check again.
        </p>
      ) : null}

      <div className="flex flex-col gap-3.5 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1 space-y-3.5">
          {data.startedWork ? (
            <div id="started-work-review" className="scroll-mt-4">
              <StartedWorkReviewPanel
                invoiceId={row.id}
                status={row.status}
                updatedAt={data.updatedAt}
                review={data.startedWork.review}
                inspection={data.startedWork.inspection}
                onUpdated={async () => {
                  if (!(await editor.reload())) throw new Error("Review saved, but the invoice could not be reloaded. Reload the page before continuing.");
                }}
              />
            </div>
          ) : null}
          <section id="invoice-lines" aria-label="Invoice lines" className="scroll-mt-32 overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
            {phone ? (
              <PhoneHeaderFacts summary={fieldsSummary}>
                <EditorFields
                  data={data}
                  grouped={grouped}
                  canToggleGst={editable}
                  frozen={frozen}
                  onGst={(enabled) => void editor.mutate("GST", { gstEnabled: enabled }, { repeatable: true })}
                  onGrouped={onGrouped}
                  reference={<ClientReferenceField saved={row.clientReference} editable={editable} frozen={frozen} mutate={editor.mutate} />}
                  mutate={draftEditable ? editor.mutate : undefined}
                />
              </PhoneHeaderFacts>
            ) : (
              <div className="max-sm:hidden">
                <EditorFields
                  data={data}
                  grouped={grouped}
                  canToggleGst={editable}
                  frozen={frozen}
                  onGst={(enabled) => void editor.mutate("GST", { gstEnabled: enabled }, { repeatable: true })}
                  onGrouped={onGrouped}
                  reference={<ClientReferenceField saved={row.clientReference} editable={editable} frozen={frozen} mutate={editor.mutate} />}
                  mutate={draftEditable ? editor.mutate : undefined}
                />
              </div>
            )}
            {phone ? (
              <EditorLineCards
                sections={sections}
                drafts={drafts}
                invalid={editor.invalid}
                editable={editable}
                frozen={frozen}
                onReorder={(ids) => void reorder(ids)}
                onRemove={setRemoving}
                onRegroup={setRegrouping}
                onEdit={(line) => setLineSheet({ mode: "edit", line })}
              />
            ) : (
              <div className="max-sm:hidden">
                <EditorLines
                  sections={sections}
                  drafts={drafts}
                  invalid={editor.invalid}
                  editable={editable}
                  frozen={frozen}
                  inputsFrozen={inputsFrozen}
                  suggestions={draftEditable ? suggestions : null}
                  gstEnabled={data.gstEnabled}
                  onAddJob={(jobId) => void addJobs([jobId])}
                  newLine={editor.newLine}
                  onDraft={editor.setLineDraft}
                  onNewLine={editor.setNewLine}
                  onAddLine={addLine}
                  onReorder={(ids) => void reorder(ids)}
                  onRefusedMove={(message) => toast({ title: "Line not moved", description: message })}
                  onRemove={setRemoving}
                  onRegroup={setRegrouping}
                />
              </div>
            )}
            <EditorTotals
              data={data}
              unsaved={editor.dirtyIds.length > 0}
              actions={
                <>
                  {editable && phone ? (
                    <EButton type="button" size="sm" variant="outline" disabled={frozen} onClick={() => setLineSheet({ mode: "add" })}>
                      Add line
                    </EButton>
                  ) : null}
                  {draftEditable ? (
                    <EButton type="button" size="sm" variant="outline" disabled={frozen} onClick={() => setAddingJobs(true)}>
                      Add finished jobs{data.draft?.unbilledJobs !== null && data.draft?.unbilledJobs !== undefined ? ` (${data.draft.unbilledJobs} not billed)` : ""}
                    </EButton>
                  ) : null}
                  <EditorFooterActions data={data} editable={editable} frozen={frozen} mutate={editor.mutate} />
                </>
              }
            />
          </section>
        </div>
        <aside aria-label="Checks and delivery" className="flex min-w-0 flex-col gap-3.5 xl:w-[330px] xl:flex-none">
          <div id="invoice-checks" className="scroll-mt-32">
            <EditorChecks checks={data.checks} />
          </div>
          <div id="invoice-send" className="scroll-mt-32">
            <SendCard
              data={data}
              to={sendTo}
              onTo={setSendTo}
              choices={sendChoices}
              onChoices={setSendChoices}
              canSend={canSend}
              resend={actions.includes("resend")}
              disabled={frozen || unsaved}
              disabledReason={unsaved ? UNSAVED_ACTION_HINT : null}
              onSend={() => void runAction(actions.includes("resend") ? "resend" : "send")}
            />
          </div>
          <div id="invoice-xero" className="scroll-mt-32">
            <XeroCard data={data} onRefresh={() => void refreshFromXero()} refresh={xeroRefresh} disabled={frozen} />
          </div>
          <div id="invoice-history" className="scroll-mt-32">
            <HistoryCard data={data} />
          </div>
        </aside>
      </div>

      {phone && lineSheet ? (
        <PhoneLineSheet
          key={lineSheet.mode === "edit" ? lineSheet.line.id : "add"}
          target={lineSheet}
          newLine={editor.newLine}
          drafts={drafts}
          suggestions={draftEditable ? suggestions : null}
          gstEnabled={data.gstEnabled}
          frozen={frozen}
          inputsFrozen={inputsFrozen}
          failure={addLineFailure}
          onNewLine={editor.setNewLine}
          onAddLine={addLine}
          onDraft={editor.setLineDraft}
          onClose={() => setLineSheet(null)}
        />
      ) : null}
      <PhoneTotalBar
        totalLabel={row.kind === "CREDIT_NOTE" ? "Total credit" : "Total"}
        total={data.totalAmount}
        subtotal={data.subtotal}
        gst={data.gstAmount}
        note={unsaved ? "Unsaved changes. Totals are the saved figures." : reviewed && checksToLook > 0 ? `${checksToLook} ${checksToLook === 1 ? "check" : "checks"} to look at` : null}
        action={totalBarAction()}
      />
      {addingJobs ? <AddJobsDialog suggestions={suggestions} busy={frozen} onAdd={addJobs} onClose={() => setAddingJobs(false)} /> : null}
      <RemoveLineDialog
        line={removing}
        draft={row.status === "DRAFT"}
        busy={saving}
        onClose={() => setRemoving(null)}
        onConfirm={(line, security) => {
          // Past DRAFT the PIN travels with the removal and is verified by the server.
          // Closed either way, so a refusal is read in the banner, not behind the modal.
          const draft = row.status === "DRAFT";
          void editor
            .mutate("Remove line", draft ? { removeLineId: line.id } : { removeLineId: line.id, security }, { repeatable: false })
            .then((removed) => {
              if (removed && draft && lineCanBeRestored(line)) offerLineUndo(line);
            })
            .finally(() => setRemoving(null));
        }}
      />
      <RegroupLineDialog
        line={regrouping}
        properties={data.clientProperties}
        busy={saving}
        onClose={() => setRegrouping(null)}
        onSave={(line, propertyId) =>
          void editor.mutate("Line grouping", { updateLines: [{ id: line.id, propertyId }] }, { repeatable: true }).finally(() => setRegrouping(null))
        }
      />
      <InvoiceDialogs
        dialog={dialog}
        context={null}
        onClose={() => setDialog(null)}
        onDone={() => {
          if (dialog?.kind === "delete") router.push(backHref);
          else void editor.reload();
        }}
      />
    </div>
  );
}
