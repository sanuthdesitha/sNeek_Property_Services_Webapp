"use client";

/**
 * One visible action per row, chosen from its state, and every other existing
 * action in the "⋯" menu. Corrections (void, reverse, reconcile, delete) sit
 * apart at the end of the menu; each opens its own confirmation.
 */
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import {
  CORRECTION_ACTIONS,
  invoiceActionLabel,
  invoiceRowActions,
  type InvoiceActionKey,
  type InvoiceRow,
} from "./invoice-model";
import { pdfHref } from "./invoice-requests";

const PRIMARY_FILLED: ReadonlySet<InvoiceActionKey> = new Set<InvoiceActionKey>(["edit", "send"]);

/** Void and Issue credit note: sensitive since owner decision 2026-11-13. */
export const VOID_CREDIT_ACTIONS: ReadonlySet<InvoiceActionKey> = new Set<InvoiceActionKey>(["void", "credit-note"]);

export function InvoiceRowActions({
  invoice,
  busy,
  disabled,
  editHref,
  voidCreditRefusal = null,
  onAction,
}: {
  invoice: InvoiceRow;
  busy: boolean;
  disabled: boolean;
  /** Why Void and Issue credit note are unavailable (no capability); null = available. */
  voidCreditRefusal?: string | null;
  /** The editor page; "Review" / "Review and edit" become links to it. */
  editHref?: string;
  onAction: (key: InvoiceActionKey, invoice: InvoiceRow) => void;
}) {
  const { primary, secondary } = invoiceRowActions(invoice);
  let separated = false;
  const items: ERowMenuItem[] = secondary.map((key) => {
    const correction = CORRECTION_ACTIONS.has(key);
    const refused = VOID_CREDIT_ACTIONS.has(key) ? voidCreditRefusal : null;
    const item: ERowMenuItem = {
      key,
      label: invoiceActionLabel(key, invoice),
      danger: key === "delete" || key === "void",
      separated: correction && !separated,
      ...(refused ? { disabled: true, hint: refused } : {}),
      ...(key === "pdf"
        ? { href: pdfHref(invoice.id), newTab: true }
        : key === "edit" && editHref
          ? { href: editHref }
          : { onSelect: () => onAction(key, invoice) }),
    };
    if (correction) separated = true;
    return item;
  });

  const primaryLabel = invoiceActionLabel(primary, invoice);
  return (
    <div className="flex items-center justify-end gap-1">
      {primary === "edit" && editHref && !(busy || disabled) ? (
        <EButton asChild size="sm" variant="primary">
          <Link href={editHref} aria-label={`${primaryLabel} ${invoice.invoiceNumber}`}>
            {primaryLabel}
          </Link>
        </EButton>
      ) : primary === "pdf" ? (
        <EButton asChild size="sm" variant="outline">
          <a href={pdfHref(invoice.id)} target="_blank" rel="noreferrer">
            {primaryLabel}
          </a>
        </EButton>
      ) : (
        <EButton
          size="sm"
          variant={PRIMARY_FILLED.has(primary) ? "primary" : "outline"}
          disabled={busy || disabled || (VOID_CREDIT_ACTIONS.has(primary) && Boolean(voidCreditRefusal))}
          title={VOID_CREDIT_ACTIONS.has(primary) && voidCreditRefusal ? voidCreditRefusal : undefined}
          onClick={() => onAction(primary, invoice)}
          aria-label={`${primaryLabel} ${invoice.invoiceNumber}`}
        >
          {busy ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
          {primaryLabel}
        </EButton>
      )}
      <ERowMenu label={`More actions for ${invoice.invoiceNumber}`} items={items} disabled={busy || disabled} />
    </div>
  );
}
