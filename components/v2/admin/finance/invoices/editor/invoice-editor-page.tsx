"use client";

/**
 * The invoice editor page (/v2/admin/finance/invoices/[id]), replacing the
 * editor modal: header and actions, the stage bar, the lines, and the checks,
 * send, Xero and history cards. Every change goes through the existing invoice
 * routes; see use-invoice-editor.ts for how saving works.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { EStageBar } from "@/components/v2/ui/stage-bar";
import { clientInvoiceStages } from "@/lib/billing/client-invoice-stage";
import type { ClientInvoiceEditorData, EditorLine } from "@/lib/billing/client-invoice-editor-types";
import { StartedWorkReviewPanel } from "../../started-work-review";
import { InvoiceDialogs, type InvoiceDialog } from "../invoice-dialogs";
import { availableInvoiceActions, type InvoiceActionKey } from "../invoice-model";
import { isDirectInvoiceAction, runDirectInvoiceAction } from "../invoice-direct-actions";
import { EditorHeader, UNSAVED_ACTION_HINT } from "./editor-header";
import { EditorFields, EditorTotals } from "./editor-fields";
import { EditorLines } from "./editor-lines";
import { EditorChecks } from "./editor-checks";
import { HistoryCard, SendCard, XeroCard } from "./editor-panels";
import { RegroupLineDialog, RemoveLineDialog } from "./editor-line-dialogs";
import { lineSections, pdfGroupsLines } from "./line-sections";
import { EMPTY_NEW_LINE, buildLineUpdates, validateNewLine } from "./line-drafts";
import { useInvoiceEditor, type SaveStatus } from "./use-invoice-editor";

const LEAVE_WARNING = "Leave without saving? Your unsaved changes on this invoice will be lost.";

/** The words beside the subtitle: saving, failed, unsaved, or when it last changed. */
export function saveStateLabel(status: SaveStatus, unsaved: boolean, updatedAt: string, timezone: string): string {
  if (status.kind === "saving") return "Saving…";
  if (status.kind === "failed") return "Not saved";
  if (unsaved) return "Unsaved changes";
  try {
    return `Last changed ${formatInTimeZone(new Date(updatedAt), timezone, "d MMM, HH:mm")}`;
  } catch {
    return "Saved";
  }
}

function StatusBanner({ status, onDismiss }: { status: SaveStatus; onDismiss: () => void }) {
  if (status.kind !== "failed") return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-danger)/0.5)] bg-[hsl(var(--e-danger-soft))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">
      <span className="min-w-0 flex-1 break-words">
        <strong className="font-[600]">{status.what}: not saved.</strong> {status.message}
      </span>
      {status.retry ? (
        <EButton type="button" size="sm" variant="outline" onClick={status.retry}>
          Retry
        </EButton>
      ) : null}
      <EButton type="button" size="sm" variant="ghost" onClick={onDismiss}>
        Dismiss
      </EButton>
    </div>
  );
}

export function InvoiceEditorPage({ initial, backHref }: { initial: ClientInvoiceEditorData; backHref: string }) {
  const router = useRouter();
  const editor = useInvoiceEditor(initial);
  const { data, drafts, status, saving } = editor;
  const [grouped, setGrouped] = useState(() => pdfGroupsLines(initial.lines));
  const [invalid, setInvalid] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<EditorLine | null>(null);
  const [regrouping, setRegrouping] = useState<EditorLine | null>(null);
  const [dialog, setDialog] = useState<InvoiceDialog>(null);
  const [sendTo, setSendTo] = useState(initial.row.client.email ?? "");
  const [actionBusy, setActionBusy] = useState(false);

  const row = data.row;
  const editable = data.editLock.editable;
  const frozen = saving || actionBusy;
  const unsaved = editor.hasUnsavedInput;
  const sections = useMemo(() => lineSections(data.lines, grouped), [data.lines, grouped]);
  const stages = clientInvoiceStages(row);
  const actions = availableInvoiceActions(row);

  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = LEAVE_WARNING;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  function saveDraft() {
    const { updates, invalid: problems } = buildLineUpdates(data.lines, drafts);
    setInvalid(problems);
    if (Object.keys(problems).length) {
      editor.setStatus({ kind: "failed", what: "Save draft", message: "Fix the marked lines, then save again.", retry: null });
      return;
    }
    if (updates.length) void editor.mutate("Save draft", { updateLines: updates }, { repeatable: true });
  }

  function addLine() {
    const checked = validateNewLine(editor.newLine);
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
      setDialog({ kind: "send", invoice: row, resend: key === "resend", to: sendTo });
      return;
    }
    if (key === "record-payment" || key === "mark-paid" || key === "receipt" || key === "void" || key === "reverse" || key === "reconcile" || key === "delete") {
      setDialog({ kind: key, invoice: row });
    }
  }

  function onBack(event: React.MouseEvent<HTMLAnchorElement>) {
    if (unsaved && !window.confirm(LEAVE_WARNING)) event.preventDefault();
  }

  const canSend = actions.includes("send") || actions.includes("resend");

  return (
    <div className="min-w-0 space-y-3.5">
      <EditorHeader
        invoice={row}
        backHref={backHref}
        saveLabel={saveStateLabel(status, editor.dirtyIds.length > 0, data.updatedAt, data.timezone)}
        canSave={editor.dirtyIds.length > 0}
        showSave={editable}
        dirty={unsaved}
        busy={frozen}
        onSave={saveDraft}
        onDiscard={() => {
          setInvalid({});
          editor.discardDrafts();
        }}
        onBack={onBack}
        onAction={(key) => void runAction(key)}
      />
      <EStageBar label="Invoice stages" stages={stages.stages} terminal={stages.terminal} />
      <StatusBanner status={status} onDismiss={() => editor.setStatus({ kind: "idle" })} />
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
          <section aria-label="Invoice lines" className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
            <EditorFields
              data={data}
              grouped={grouped}
              canToggleGst={editable}
              frozen={frozen}
              onGst={(enabled) => void editor.mutate("GST", { gstEnabled: enabled }, { repeatable: true })}
              onGrouped={setGrouped}
            />
            <EditorLines
              sections={sections}
              drafts={drafts}
              invalid={invalid}
              editable={editable}
              frozen={frozen}
              newLine={editor.newLine}
              onDraft={editor.setLineDraft}
              onNewLine={editor.setNewLine}
              onAddLine={addLine}
              onReorder={(ids) => void reorder(ids)}
              onRefusedMove={(message) => toast({ title: "Line not moved", description: message })}
              onRemove={setRemoving}
              onRegroup={setRegrouping}
            />
            <EditorTotals data={data} unsaved={editor.dirtyIds.length > 0} />
          </section>
        </div>
        <aside aria-label="Checks and delivery" className="flex min-w-0 flex-col gap-3.5 xl:w-[330px] xl:flex-none">
          <EditorChecks checks={data.checks} />
          <SendCard
            data={data}
            to={sendTo}
            onTo={setSendTo}
            canSend={canSend}
            resend={actions.includes("resend")}
            disabled={frozen || unsaved}
            disabledReason={unsaved ? UNSAVED_ACTION_HINT : null}
            onSend={() => void runAction(actions.includes("resend") ? "resend" : "send")}
          />
          <XeroCard data={data} />
          <HistoryCard data={data} />
        </aside>
      </div>

      <RemoveLineDialog
        line={removing}
        busy={saving}
        onClose={() => setRemoving(null)}
        onRefused={(message) => toast({ title: "Line not removed", description: message, variant: "destructive" })}
        onVerified={(line) =>
          // Closed either way, so a refusal is read in the banner, not behind the modal.
          void editor.mutate("Remove line", { removeLineId: line.id }, { repeatable: false }).finally(() => setRemoving(null))
        }
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
