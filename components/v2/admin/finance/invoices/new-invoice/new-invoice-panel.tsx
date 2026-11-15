"use client";

/**
 * New invoice (board "New invoice", approved 2026-11-14): one panel for the
 * three kinds the "New invoice ▾" menu offered as separate dialogs — from
 * finished jobs, blank invoice and credit note — opened as a full page from
 * that menu (old `?new=` links on the list land here). Drafts are never sent
 * or approved from here.
 *
 * Each choice keeps its fields while another is shown (panels stay mounted
 * once opened), and the choice is kept in the URL (`?kind=`).
 */
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { InvoiceFormContext } from "../invoice-model";
import { INVOICE_LIST_BASE } from "../invoice-links";
import { NEW_INVOICE_KINDS, newInvoicePath, type NewInvoiceKind } from "./new-invoice-format";
import { FromJobsPanel } from "./from-jobs-panel";
import { BlankInvoicePanel, CreditNotePanel } from "./blank-and-credit-panels";

export type NewInvoicePanelProps = {
  context: InvoiceFormContext;
  initialKind: NewInvoiceKind;
  initialClientId: string;
  canManage: boolean;
  canVoidCredit: boolean;
  timeZone: string;
};

function KindChooser({ kind, canVoidCredit, onChoose }: { kind: NewInvoiceKind; canVoidCredit: boolean; onChoose: (kind: NewInvoiceKind) => void }) {
  return (
    <fieldset className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
      <legend className="sr-only">What to create</legend>
      {NEW_INVOICE_KINDS.map((option) => {
        const active = option.key === kind;
        const refused = option.key === "credit" && !canVoidCredit;
        return (
          <label
            key={option.key}
            className={cn(
              "flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--e-radius-lg)] border px-3.5 py-3",
              active ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))]" : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]",
            )}
          >
            <input type="radio" name="new-invoice-kind" value={option.key} checked={active} onChange={() => onChoose(option.key)} className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--e-primary))]" />
            <span className="min-w-0">
              <span className="block text-[0.9375rem] font-[600]">{option.label}</span>
              <span className="block text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                {refused ? "Needs the void and credit notes right, which your account does not have" : option.detail}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function NewInvoicePanel({ context, initialKind, initialClientId, canManage, canVoidCredit, timeZone }: NewInvoicePanelProps) {
  const [kind, setKind] = React.useState<NewInvoiceKind>(initialKind);
  const [visited, setVisited] = React.useState<Set<NewInvoiceKind>>(() => new Set([initialKind]));

  function choose(next: NewInvoiceKind) {
    setKind(next);
    setVisited((current) => (current.has(next) ? current : new Set(current).add(next)));
    if (typeof window !== "undefined") window.history.replaceState(window.history.state, "", newInvoicePath(next));
  }

  return (
    <div className="space-y-4">
      <header>
        <p className="text-[0.8125rem]">
          <Link href={`${INVOICE_LIST_BASE}?tab=invoices`} className="text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">← Invoices and pay</Link>
        </p>
        <h1 className="e-display-md mt-1">New invoice</h1>
        <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          See exactly which jobs go on the draft, at what charge and why, before it is made. Drafts are never sent or approved from here.
        </p>
      </header>
      <KindChooser kind={kind} canVoidCredit={canVoidCredit} onChoose={choose} />
      <div hidden={kind !== "jobs"}>
        {visited.has("jobs") ? <FromJobsPanel context={context} canManage={canManage} initialClientId={initialClientId} timeZone={timeZone} /> : null}
      </div>
      <div hidden={kind !== "blank"}>
        {visited.has("blank") ? <BlankInvoicePanel clients={context.clients} canManage={canManage} initialClientId={initialClientId} /> : null}
      </div>
      <div hidden={kind !== "credit"}>
        {visited.has("credit") ? <CreditNotePanel canVoidCredit={canVoidCredit && canManage} /> : null}
      </div>
    </div>
  );
}
