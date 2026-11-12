"use client";

/**
 * The invoice's header fields and its totals footer.
 *
 * On an editable DRAFT, Bill to, Period and Due are fields (Wave D,
 * editor-draft-fields.tsx); once approved or later they are read only. The due
 * day is derived (created + payment terms) exactly as the PDF prints it, and is
 * provisional until first sent. GST saves on its own.
 * "Group by property" on an editable invoice also saves the grouped line order
 * (as the old editor did); on a read-only invoice it only changes the view. The
 * PDF groups by property whenever the invoice spans more than one.
 */
import type { ClientInvoiceEditorData } from "@/lib/billing/client-invoice-editor-types";
import { cn } from "@/lib/utils";
import { formatPeriod } from "../invoice-columns";
import { fmtDay, money } from "../invoice-model";
import { BillToField, DueField, PeriodField } from "./editor-draft-fields";
import type { MutationOptions } from "./use-invoice-editor";

const LABEL = "mb-1 block text-[0.6875rem] font-[600] text-[hsl(var(--e-text-secondary))]";
const VALUE = "flex min-h-9 items-center text-[0.8125rem] text-[hsl(var(--e-foreground))]";

export function EditorFields({
  data,
  grouped,
  canToggleGst,
  frozen,
  onGst,
  onGrouped,
  reference,
  mutate,
}: {
  data: ClientInvoiceEditorData;
  grouped: boolean;
  canToggleGst: boolean;
  frozen: boolean;
  onGst: (enabled: boolean) => void;
  onGrouped: (grouped: boolean) => void;
  /** The client reference field (editor-extras), drawn after Due. */
  reference?: React.ReactNode;
  /** Set on an editable DRAFT: Bill to, Period and Due become fields. */
  mutate?: (what: string, body: Record<string, unknown>, options: MutationOptions) => Promise<boolean>;
}) {
  const { row } = data;
  const sent = row.status !== "DRAFT" && row.status !== "APPROVED";
  if (data.draft && canToggleGst && mutate) {
    return (
      <div className="flex flex-wrap items-start gap-x-5 gap-y-3 border-b border-[hsl(var(--e-border))] px-4 py-3.5">
        <BillToField data={data} draft={data.draft} frozen={frozen} mutate={mutate} />
        <PeriodField draft={data.draft} frozen={frozen} mutate={mutate} />
        <DueField data={data} draft={data.draft} frozen={frozen} mutate={mutate} />
        {reference}
        <span className="hidden flex-1 sm:block" />
        <GstAndGrouping data={data} grouped={grouped} canToggleGst={canToggleGst} frozen={frozen} onGst={onGst} onGrouped={onGrouped} />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-b border-[hsl(var(--e-border))] px-4 py-3.5">
      <dl className="flex min-w-0 flex-wrap gap-x-5 gap-y-3">
        <div className="min-w-0">
          <dt className={LABEL}>Bill to</dt>
          <dd className={cn(VALUE, "break-words")}>{row.client.name}</dd>
        </div>
        <div>
          <dt className={LABEL}>Period</dt>
          <dd className={VALUE}>{formatPeriod(row.periodStart, row.periodEnd)}</dd>
        </div>
        <div>
          <dt className={LABEL}>Due</dt>
          <dd className={VALUE} title={`Printed on the PDF: created + ${data.paymentTermsDays} days`}>
            {fmtDay(row.dueDate)}
            <span className="ml-1 text-[hsl(var(--e-muted-foreground))]">
              · {data.paymentTermsDays}-day terms{sent ? "" : ", provisional until sent"}
            </span>
          </dd>
        </div>
      </dl>
      {reference}
      <span className="hidden flex-1 sm:block" />
      <GstAndGrouping data={data} grouped={grouped} canToggleGst={canToggleGst} frozen={frozen} onGst={onGst} onGrouped={onGrouped} />
    </div>
  );
}

function GstAndGrouping({
  data,
  grouped,
  canToggleGst,
  frozen,
  onGst,
  onGrouped,
}: {
  data: ClientInvoiceEditorData;
  grouped: boolean;
  canToggleGst: boolean;
  frozen: boolean;
  onGst: (enabled: boolean) => void;
  onGrouped: (grouped: boolean) => void;
}) {
  return (
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-11 items-center gap-2 text-[0.8125rem] sm:min-h-9">
          <input
            type="checkbox"
            className="h-[15px] w-[15px] accent-[hsl(var(--e-primary))]"
            checked={data.gstEnabled}
            disabled={!canToggleGst || frozen}
            onChange={(event) => onGst(event.target.checked)}
          />
          GST 10%
        </label>
        <button
          type="button"
          aria-pressed={grouped}
          // On an editable invoice the toggle saves the order, so it waits for any save.
          disabled={canToggleGst && frozen}
          title={canToggleGst && !grouped ? "Groups the lines by property and saves that order" : undefined}
          onClick={() => onGrouped(!grouped)}
          className={cn(
            "inline-flex h-11 items-center rounded-[var(--e-radius-pill)] border px-3 text-[0.75rem] font-[500] disabled:opacity-50 sm:h-7",
            grouped
              ? "border-[hsl(var(--e-primary)/0.35)] bg-[hsl(var(--e-primary-soft))] font-[600] text-[hsl(var(--e-primary))]"
              : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-text-secondary))]",
          )}
        >
          Group by property
        </button>
      </div>
  );
}

export function EditorTotals({
  data,
  unsaved,
  actions,
}: {
  data: ClientInvoiceEditorData;
  unsaved: boolean;
  /** Add discount / note to client (editor-extras), drawn left of the totals. */
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-t border-[hsl(var(--e-border))] px-4 py-3.5">
      <div className="min-w-0 space-y-2">
        {actions}
        <p className="max-w-[22rem] text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          {unsaved ? "Totals are the saved figures. Save your changes to update them." : null}
        </p>
      </div>
      <dl className="grid grid-cols-[90px_110px] gap-x-2.5 gap-y-1.5 text-right e-tnum">
        <dt className="text-[hsl(var(--e-muted-foreground))]">Subtotal</dt>
        <dd>{money(data.subtotal)}</dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">GST</dt>
        <dd>{money(data.gstAmount)}</dd>
        <dt className="font-[600] text-[hsl(var(--e-foreground))]">{data.row.kind === "CREDIT_NOTE" ? "Total credit" : "Total"}</dt>
        <dd className="text-[1rem] font-[600]">{money(data.totalAmount)}</dd>
      </dl>
    </div>
  );
}
