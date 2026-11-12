"use client";

/**
 * Money step (c) controls on the invoice editor, placed as drawn:
 *   - "Client reference" in the header fields (PO number; saved when the field
 *     is left or Enter is pressed, an absolute value that is safe to repeat);
 *   - "Add discount" and "Add note to client" in the lines footer;
 *   - the credit-note links ("Credits INV-…" / "Credited by CN-…").
 * All amounts are worked out by the server (the PATCH and the one totals
 * function); nothing here does money arithmetic.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ETextarea } from "@/components/v2/admin/estate-kit";
import type { ClientInvoiceEditorData } from "@/lib/billing/client-invoice-editor-types";
import { invoiceEditorPath } from "../invoice-links";
import { STATUS_LABEL, money } from "../invoice-model";
import type { MutationOptions } from "./use-invoice-editor";

type Mutate = (what: string, body: Record<string, unknown>, options: MutationOptions) => Promise<boolean>;

const LABEL = "mb-1 block text-[0.6875rem] font-[600] text-[hsl(var(--e-text-secondary))]";
export const CLIENT_REFERENCE_MAX = 100;
export const CLIENT_NOTE_MAX = 2000;

export function ClientReferenceField({
  saved,
  editable,
  frozen,
  mutate,
}: {
  saved: string | null;
  editable: boolean;
  frozen: boolean;
  mutate: Mutate;
}) {
  const [value, setValue] = useState(saved ?? "");
  // A reload after any save shows the stored value.
  useEffect(() => setValue(saved ?? ""), [saved]);

  function commit() {
    const next = value.trim();
    if (next === (saved ?? "")) return;
    void mutate("Client reference", { clientReference: next || null }, { repeatable: true });
  }

  if (!editable) {
    return (
      <div className="min-w-0">
        <span className={LABEL}>Client reference</span>
        <span className="flex min-h-9 items-center break-words text-[0.8125rem]">{saved || "—"}</span>
      </div>
    );
  }
  return (
    <div>
      <label className={LABEL} htmlFor="invoice-client-reference">
        Client reference
      </label>
      <EInput
        id="invoice-client-reference"
        className="w-[10rem]"
        placeholder="PO number"
        maxLength={CLIENT_REFERENCE_MAX}
        value={value}
        disabled={frozen}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
    </div>
  );
}

type DiscountMode = "amount" | "percent";

function DiscountDialog({ busy, mutate, onClose }: { busy: boolean; mutate: Mutate; onClose: () => void }) {
  const [mode, setMode] = useState<DiscountMode>("amount");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const number = Number(value);
    if (!value.trim() || !Number.isFinite(number) || number <= 0) {
      setError(mode === "percent" ? "Enter a percentage above 0 and at most 100." : "Enter an amount above zero.");
      return;
    }
    if (mode === "percent" && number > 100) {
      setError("A percentage discount can be at most 100.");
      return;
    }
    setError(null);
    const addDiscount = {
      ...(mode === "percent" ? { percent: number } : { amount: number }),
      ...(description.trim() ? { description: description.trim() } : {}),
    };
    // Not repeatable: a lost answer may already have added the discount.
    const saved = await mutate("Add discount", { addDiscount }, { repeatable: false });
    if (saved) onClose();
  }

  return (
    <EModal open onClose={() => !busy && onClose()} eyebrow="Invoice" title="Add discount">
      <fieldset disabled={busy} className="space-y-3">
        <div role="radiogroup" aria-label="Discount as" className="flex flex-wrap gap-3 text-[0.8125rem]">
          <label className="inline-flex min-h-11 items-center gap-2 sm:min-h-9">
            <input type="radio" name="discount-mode" checked={mode === "amount"} onChange={() => setMode("amount")} />
            An amount ($)
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 sm:min-h-9">
            <input type="radio" name="discount-mode" checked={mode === "percent"} onChange={() => setMode("percent")} />
            A percentage of the subtotal
          </label>
        </div>
        <EField label={mode === "percent" ? "Percentage" : "Amount (before GST)"} hint="Shown on the invoice as a negative line. It cannot take the total below zero.">
          <EInput inputMode="decimal" aria-label={mode === "percent" ? "Percentage" : "Amount (before GST)"} value={value} onChange={(event) => setValue(event.target.value)} />
        </EField>
        <EField label="Description (optional)">
          <EInput aria-label="Description (optional)" maxLength={500} placeholder="Discount" value={description} onChange={(event) => setDescription(event.target.value)} />
        </EField>
        {error ? (
          <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <EButton type="button" variant="ghost" onClick={onClose}>
            Cancel
          </EButton>
          <EButton type="button" onClick={() => void add()}>
            Add discount
          </EButton>
        </div>
      </fieldset>
    </EModal>
  );
}

function NoteDialog({ saved, busy, mutate, onClose }: { saved: string | null; busy: boolean; mutate: Mutate; onClose: () => void }) {
  const [note, setNote] = useState(saved ?? "");
  async function save() {
    const next = note.trim();
    const done = await mutate("Note to client", { clientNote: next || null }, { repeatable: true });
    if (done) onClose();
  }
  return (
    <EModal open onClose={() => !busy && onClose()} eyebrow="Invoice" title="Note to client">
      <fieldset disabled={busy} className="space-y-3">
        <EField label="Note" hint={`Printed on the PDF under the lines. Up to ${CLIENT_NOTE_MAX} characters.`}>
          <ETextarea aria-label="Note" rows={5} maxLength={CLIENT_NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} />
        </EField>
        <div className="flex justify-end gap-2">
          <EButton type="button" variant="ghost" onClick={onClose}>
            Cancel
          </EButton>
          <EButton type="button" onClick={() => void save()}>
            Save note
          </EButton>
        </div>
      </fieldset>
    </EModal>
  );
}

/** Footer actions beside the totals: Add discount (invoices only) and the note to the client. */
export function EditorFooterActions({
  data,
  editable,
  frozen,
  mutate,
}: {
  data: ClientInvoiceEditorData;
  editable: boolean;
  frozen: boolean;
  mutate: Mutate;
}) {
  const [open, setOpen] = useState<"discount" | "note" | null>(null);
  const creditNote = data.row.kind === "CREDIT_NOTE";
  return (
    <div className="min-w-0 max-w-[26rem] space-y-2">
      {editable ? (
        <div className="flex flex-wrap gap-2">
          {!creditNote ? (
            <EButton type="button" size="sm" variant="outline" disabled={frozen} onClick={() => setOpen("discount")}>
              Add discount
            </EButton>
          ) : null}
          <EButton type="button" size="sm" variant="outline" disabled={frozen} onClick={() => setOpen("note")}>
            {data.clientNote ? "Edit note to client" : "Add note to client"}
          </EButton>
        </div>
      ) : null}
      {data.clientNote ? (
        <div className="text-[0.75rem]">
          <span className="font-[600] text-[hsl(var(--e-text-secondary))]">Note to client: </span>
          <span className="whitespace-pre-line break-words">{data.clientNote}</span>
        </div>
      ) : null}
      {open === "discount" ? <DiscountDialog busy={frozen} mutate={mutate} onClose={() => setOpen(null)} /> : null}
      {open === "note" ? <NoteDialog saved={data.clientNote} busy={frozen} mutate={mutate} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** "Credits INV-…" on a credit note; "Credited by CN-…" on an invoice. */
export function CreditLinks({ data }: { data: ClientInvoiceEditorData }) {
  const { row } = data;
  if (row.kind === "CREDIT_NOTE") {
    if (!row.credits) return null;
    return (
      <p className="text-[0.8125rem]">
        Credit note · credits{" "}
        <Link className="font-mono text-[hsl(var(--e-primary))] underline-offset-2 hover:underline" href={invoiceEditorPath(row.credits.id)}>
          {row.credits.invoiceNumber}
        </Link>
      </p>
    );
  }
  if (!row.creditedBy.length) return null;
  return (
    <p className="text-[0.8125rem]">
      Credited by{" "}
      {row.creditedBy.map((note, index) => (
        <span key={note.id}>
          {index > 0 ? ", " : ""}
          <Link className="font-mono text-[hsl(var(--e-primary))] underline-offset-2 hover:underline" href={invoiceEditorPath(note.id)}>
            {note.invoiceNumber}
          </Link>{" "}
          <span className="text-[hsl(var(--e-muted-foreground))]">
            ({STATUS_LABEL[note.status]}, {money(note.totalAmount)})
          </span>
        </span>
      ))}
      {row.fullyCredited ? <span className="ml-1 font-[600]">· Fully credited, nothing owed</span> : null}
    </p>
  );
}
