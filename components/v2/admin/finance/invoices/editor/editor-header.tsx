"use client";

/**
 * Back link, the page's one h1 (number + status), the save state, and the
 * actions: Preview PDF, Save draft, the ONE primary action for the stage (the
 * list's own choice) and a "more" menu holding every other existing action.
 * Actions that act on the stored invoice wait while there are unsaved edits.
 */
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import {
  ACTS_ON_SAVED_INVOICE,
  CORRECTION_ACTIONS,
  STATUS_LABEL,
  editorMenuActions,
  editorPrimaryAction,
  invoiceActionLabel,
  type InvoiceActionKey,
  type InvoiceRow,
} from "../invoice-model";
import { STATUS_PILL, formatPeriod } from "../invoice-columns";
import { pdfDownloadHref, pdfHref } from "../invoice-requests";

export const UNSAVED_ACTION_HINT = "Save or discard your changes first.";

export type EditorHeaderProps = {
  invoice: InvoiceRow;
  backHref: string;
  saveLabel: string;
  canSave: boolean;
  showSave: boolean;
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onBack: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  onAction: (key: InvoiceActionKey) => void;
};

function menuItems(props: EditorHeaderProps): ERowMenuItem[] {
  const { invoice, dirty } = props;
  let separated = false;
  return editorMenuActions(invoice).map((key) => {
    const correction = CORRECTION_ACTIONS.has(key);
    const waits = dirty && ACTS_ON_SAVED_INVOICE.has(key);
    const item: ERowMenuItem =
      key === "pdf"
        ? { key, label: "Download PDF", href: pdfDownloadHref(invoice.id) }
        : {
            key,
            label: invoiceActionLabel(key, invoice),
            danger: key === "delete" || key === "void",
            separated: correction && !separated,
            disabled: waits,
            hint: waits ? UNSAVED_ACTION_HINT : undefined,
            onSelect: () => props.onAction(key),
          };
    if (correction) separated = true;
    return item;
  });
}

export function EditorHeader(props: EditorHeaderProps) {
  const { invoice, busy, dirty } = props;
  const primary = editorPrimaryAction(invoice);
  const primaryWaits = primary !== null && dirty && ACTS_ON_SAVED_INVOICE.has(primary);
  const period = formatPeriod(invoice.periodStart, invoice.periodEnd);
  return (
    <div className="space-y-1">
      <Link
        href={props.backHref}
        onClick={props.onBack}
        className="inline-flex min-h-11 items-center text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline sm:min-h-0"
      >
        ← Client invoices
      </Link>
      <EPageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="break-all">{invoice.invoiceNumber}</span>
            <EPill tone={STATUS_PILL[invoice.status]}>{STATUS_LABEL[invoice.status]}</EPill>
            {invoice.kind === "CREDIT_NOTE" ? <EPill tone="info">Credit note</EPill> : null}
            {invoice.fullyCredited ? <EPill tone="info">Fully credited</EPill> : null}
          </span>
        }
        description={
          <>
            <span className="break-words">{invoice.client.name}</span>
            {period !== "—" ? ` · ${period}` : ""} ·{" "}
            <span role="status" aria-live="polite">
              {props.saveLabel}
            </span>
          </>
        }
        actions={
          <>
            <EButton asChild size="sm" variant="outline">
              <a href={pdfHref(invoice.id)} target="_blank" rel="noreferrer">
                Preview PDF
              </a>
            </EButton>
            {props.showSave ? (
              <>
                {dirty ? (
                  <EButton type="button" size="sm" variant="ghost" disabled={busy} onClick={props.onDiscard}>
                    Discard
                  </EButton>
                ) : null}
                <EButton type="button" size="sm" variant="outline" disabled={busy || !props.canSave} onClick={props.onSave}>
                  {busy ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
                  Save draft
                </EButton>
              </>
            ) : null}
            {primary ? (
              <EButton
                type="button"
                size="sm"
                variant="primary"
                disabled={busy || primaryWaits}
                title={primaryWaits ? UNSAVED_ACTION_HINT : undefined}
                onClick={() => props.onAction(primary)}
              >
                {invoiceActionLabel(primary, invoice)}
              </EButton>
            ) : null}
            <ERowMenu label={`More actions for ${invoice.invoiceNumber}`} items={menuItems(props)} disabled={busy} />
          </>
        }
      />
    </div>
  );
}
