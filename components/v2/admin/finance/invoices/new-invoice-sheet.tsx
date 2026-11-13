"use client";

/**
 * Phones only (below 640px): "New invoice" as a bottom sheet (board "Admin
 * phone: Invoice editor", New invoice). The same three choices as the desktop
 * header's "New invoice ▾" menu: From finished jobs, Blank invoice and Credit
 * note. Continue opens the same dialog the menu opens; nothing is created
 * until that dialog is completed. A credit note is refused here, with the
 * same words, when the viewer lacks the void and credit notes capability.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { EBottomSheet } from "@/components/v2/ui/bottom-sheet";
import { EButton } from "@/components/v2/ui/primitives";

export type NewInvoiceChoice = "jobs" | "blank" | "credit";

const CHOICES: Array<{ key: NewInvoiceChoice; label: string; detail: string }> = [
  { key: "jobs", label: "From finished jobs", detail: "Draft invoices from jobs not yet on an invoice" },
  { key: "blank", label: "Blank invoice", detail: "Choose a client and period" },
  { key: "credit", label: "Credit note", detail: "Choose the invoice to credit" },
];

type NewInvoiceSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Why a credit note cannot be started, or null when it can. */
  creditRefusal: string | null;
  onContinue: (choice: NewInvoiceChoice) => void;
};

export function NewInvoiceSheet({ open, onOpenChange, creditRefusal, onContinue }: NewInvoiceSheetProps) {
  const [choice, setChoice] = useState<NewInvoiceChoice>("jobs");
  const refused = choice === "credit" ? creditRefusal : null;
  return (
    <EBottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New invoice"
      footer={(
        <EButton
          className="w-full"
          disabled={Boolean(refused)}
          onClick={() => {
            onOpenChange(false);
            onContinue(choice);
          }}
        >
          Continue
        </EButton>
      )}
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">What to create</legend>
        {CHOICES.map((option) => (
          <label
            key={option.key}
            className={cn(
              "flex min-h-11 cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-3",
              choice === option.key ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))]" : "border-[hsl(var(--e-border))]",
            )}
          >
            <input type="radio" name="new-invoice-choice" value={option.key} checked={choice === option.key} onChange={() => setChoice(option.key)} className="mt-1 h-4 w-4 accent-[hsl(var(--e-primary))]" />
            <span className="min-w-0">
              <span className="block text-[0.9375rem] font-[600]">{option.label}</span>
              <span className="block text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{option.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {refused ? <p role="alert" className="mt-3 text-[0.8125rem] text-[hsl(var(--e-danger))]">{refused}</p> : null}
    </EBottomSheet>
  );
}
