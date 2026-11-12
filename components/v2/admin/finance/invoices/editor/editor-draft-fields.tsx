"use client";

/**
 * Bill to, Period and Due as editable fields on a DRAFT (Wave D). Each change
 * is one PATCH with the version guard; the server decides (a client change is
 * refused unless every job belongs to the new client) and its reason shows in
 * the save banner. The period never adds or removes lines; the server's
 * warning (lines outside it) is shown here. Due is the client's terms or this
 * invoice's own terms; the due day (created + terms, the PDF's rule) stays
 * provisional until the first send fixes the terms.
 */
import { useEffect, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EInput, ESelect } from "@/components/v2/admin/estate-kit";
import type { ClientInvoiceEditorData, EditorDraftPanel } from "@/lib/billing/client-invoice-editor-types";
import { fmtDay } from "../invoice-model";
import type { MutationOptions } from "./use-invoice-editor";

type Mutate = (what: string, body: Record<string, unknown>, options: MutationOptions) => Promise<boolean>;

const LABEL = "mb-1 block text-[0.6875rem] font-[600] text-[hsl(var(--e-text-secondary))]";
const TERM_CHOICES = [0, 7, 14, 21, 30, 45, 60, 90];

function warningsOf(body: Record<string, unknown>): string[] {
  return Array.isArray(body.warnings) ? body.warnings.filter((value): value is string => typeof value === "string") : [];
}

export function BillToField({ data, draft, frozen, mutate }: { data: ClientInvoiceEditorData; draft: EditorDraftPanel; frozen: boolean; mutate: Mutate }) {
  const current = data.row.client.id;
  const options = draft.clients.some((client) => client.id === current) ? draft.clients : [{ id: current, name: data.row.client.name }, ...draft.clients];
  return (
    <div className="min-w-0">
      <label className={LABEL} htmlFor="invoice-bill-to">
        Bill to
      </label>
      <ESelect
        id="invoice-bill-to"
        className="w-[13rem] max-w-full"
        value={current}
        disabled={frozen || data.row.kind === "CREDIT_NOTE"}
        onChange={(event) => void mutate("Bill to", { clientId: event.target.value }, { repeatable: true })}
      >
        {options.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </ESelect>
    </div>
  );
}

export function PeriodField({ draft, frozen, mutate }: { draft: EditorDraftPanel; frozen: boolean; mutate: Mutate }) {
  const [start, setStart] = useState(draft.periodStartDay ?? "");
  const [end, setEnd] = useState(draft.periodEndDay ?? "");
  const [warning, setWarning] = useState<string | null>(null);
  // A reload after any save shows the stored period.
  useEffect(() => setStart(draft.periodStartDay ?? ""), [draft.periodStartDay]);
  useEffect(() => setEnd(draft.periodEndDay ?? ""), [draft.periodEndDay]);
  const changed = start !== (draft.periodStartDay ?? "") || end !== (draft.periodEndDay ?? "");
  const invalid = !start || !end || start > end;

  async function save() {
    setWarning(null);
    await mutate("Period", { period: { start, end } }, {
      repeatable: true,
      onSuccess: (body) => setWarning(warningsOf(body).join(" ") || null),
    });
  }

  return (
    <fieldset className="min-w-0">
      <legend className={LABEL}>Period</legend>
      <div className="flex flex-wrap items-center gap-1.5">
        <EInput type="date" aria-label="Period from" className="w-[9.5rem]" value={start} max={end || undefined} disabled={frozen} onChange={(event) => setStart(event.target.value)} />
        <span aria-hidden>–</span>
        <EInput type="date" aria-label="Period to" className="w-[9.5rem]" value={end} min={start || undefined} disabled={frozen} onChange={(event) => setEnd(event.target.value)} />
        {changed ? (
          <EButton type="button" size="sm" variant="outline" disabled={frozen || invalid} onClick={() => void save()}>
            Save period
          </EButton>
        ) : null}
      </div>
      {changed && invalid ? <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-danger))]">Choose both dates, start on or before end.</p> : null}
      {warning ? <p role="status" className="mt-1 max-w-[22rem] text-[0.75rem] text-[hsl(var(--e-warning))]">{warning}</p> : null}
    </fieldset>
  );
}

export function DueField({ data, draft, frozen, mutate }: { data: ClientInvoiceEditorData; draft: EditorDraftPanel; frozen: boolean; mutate: Mutate }) {
  const value = draft.termsOverride === null ? "client" : String(draft.termsOverride);
  const choices = draft.termsOverride !== null && !TERM_CHOICES.includes(draft.termsOverride) ? [...TERM_CHOICES, draft.termsOverride].sort((a, b) => a - b) : TERM_CHOICES;
  return (
    <div>
      <label className={LABEL} htmlFor="invoice-due-terms">
        Due
      </label>
      <ESelect
        id="invoice-due-terms"
        className="w-[13rem] max-w-full"
        value={value}
        disabled={frozen}
        aria-describedby="invoice-due-hint"
        onChange={(event) =>
          void mutate("Due terms", { paymentTermsDays: event.target.value === "client" ? null : Number(event.target.value) }, { repeatable: true })
        }
      >
        <option value="client">Client terms ({draft.clientTermsDays} days)</option>
        {choices.map((days) => (
          <option key={days} value={String(days)}>
            {days}-day terms · this invoice only
          </option>
        ))}
      </ESelect>
      <p id="invoice-due-hint" className="mt-1 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
        Provisional: {fmtDay(data.row.dueDate)} (created + {data.paymentTermsDays} days). The terms are fixed when first sent.
      </p>
    </div>
  );
}
