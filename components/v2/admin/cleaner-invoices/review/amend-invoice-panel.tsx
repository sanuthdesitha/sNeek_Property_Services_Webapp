"use client";

/**
 * Amend a submitted cleaner invoice (2026-11-23): a lazy disclosure under the
 * lines on the review page. The office edits each line's description,
 * quantity (or hours) and unit amount, removes or adds lines, may change the
 * invoice's hours and must give a reason; the change list and the new total
 * come from the same rules the server applies (invoice-amend-rules.ts).
 *
 * - The draft remembers which version of the invoice it was started from and
 *   saves against that version; if the invoice changed meanwhile the save is
 *   refused and the draft is kept, with "Start again from the current invoice".
 * - Fields are frozen while saving. A failed save keeps the draft and its
 *   request key, so pressing Save again is the same request (never a second
 *   amendment); the key is replaced only after a successful save.
 * - The panel is keyed by invoice by its caller; another invoice starts empty.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import type { CleanerInvoiceRow } from "@/lib/cleaner/invoice-admin-list-types";
import { amendPermission, describeAmendment, formatAud, lineAmount, planAmendment, readStoredLines, type AmendLineInput, type BillLineCategory } from "@/lib/cleaner/invoice-amend-rules";
import { MUTED, SMALL } from "../../pay-records/record-parts";

type DraftLine = {
  key: string;
  sourceIndex: number | null;
  description: string;
  quantity: string;
  unitAmount: string;
  category: BillLineCategory;
  removed: boolean;
};

type Draft = {
  baseUpdatedAt: string;
  baseRevision: number;
  requestKey: string;
  lines: DraftLine[];
  hours: string;
  reason: string;
  note: string;
};

type NoticeOutcome = { transport: string; path: string; state: string; errorCode?: string | null };
type SaveResult = {
  revision: number;
  beforeTotal: number;
  afterTotal: number;
  changes: string[];
  needsXeroUpdate: boolean;
  notice: { status: "sent"; outcomes: NoticeOutcome[] } | { status: "not-sent"; reason: string } | null;
};

type SaveState = { status: "idle" } | { status: "saving" } | { status: "error"; message: string; stale: boolean } | { status: "saved"; result: SaveResult };

const CATEGORY_LABEL: Record<BillLineCategory, string> = { LABOUR: "Cleaning work", INSPECTION: "QA inspection", REIMBURSEMENT: "Reimbursement" };

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `amend-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function draftFrom(row: CleanerInvoiceRow): Draft {
  const { lines } = readStoredLines(row.lineData);
  return {
    baseUpdatedAt: row.updatedAt ?? "",
    baseRevision: row.amendmentCount ?? 0,
    requestKey: newKey(),
    lines: lines.map((line, index) => ({
      key: `s${index}`,
      sourceIndex: index,
      description: line.description,
      quantity: String(line.quantity),
      unitAmount: line.unitAmount.toFixed(2),
      category: (line.extra.category as BillLineCategory) ?? "LABOUR",
      removed: false,
    })),
    hours: Number(row.hours ?? 0).toFixed(2),
    reason: "",
    note: "",
  };
}

function numberOr(raw: string): number {
  const value = Number(raw.trim());
  return raw.trim() === "" ? Number.NaN : value;
}

function requestLines(draft: Draft): AmendLineInput[] {
  return draft.lines
    .filter((line) => !line.removed)
    .map((line) => ({
      sourceIndex: line.sourceIndex,
      description: line.description,
      quantity: numberOr(line.quantity),
      unitAmount: numberOr(line.unitAmount),
      ...(line.sourceIndex === null ? { category: line.category } : {}),
    }));
}

const STATE_TEXT: Record<string, string> = {
  queued: "queued (not yet delivered)",
  inbox_available: "in their inbox",
  provider_accepted: "accepted by the email provider (not proof it was read)",
  requested: "requested",
  already_requested: "already sent for this amendment",
  uncertain: "outcome unknown",
  skipped: "not sent",
  failed: "failed",
  switched_off: "switched off for this type",
};

export function noticeText(notice: SaveResult["notice"]): string {
  if (!notice) return "The payee's notice has not been sent yet.";
  if (notice.status === "not-sent") return `The payee was not told: ${notice.reason}`;
  return notice.outcomes
    .map((outcome) => {
      const label = outcome.transport === "EMAIL" ? "Email" : outcome.transport === "INBOX" ? "In-app notice" : outcome.transport;
      const reason = outcome.errorCode === "recipient_switched_off" ? " (the payee switched these off)" : outcome.errorCode ? ` (${outcome.errorCode.replace(/_/g, " ")})` : "";
      return `${label}: ${STATE_TEXT[outcome.state] ?? outcome.state}${reason}`;
    })
    .join(" · ");
}

export function AmendInvoicePanel({ row, role }: { row: CleanerInvoiceRow; role: string }) {
  const router = useRouter();
  const permission = amendPermission({ status: row.status, xeroBillId: row.xeroBillId, paidAt: row.paidAt, paidAmount: row.paidAmount }, role);
  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(row));
  const [save, setSave] = React.useState<SaveState>({ status: "idle" });
  const saving = save.status === "saving";
  const stale = Boolean(row.updatedAt) && draft.baseUpdatedAt !== row.updatedAt;
  const reasonId = React.useId();

  if (!permission.ok) {
    return <p className={cn(SMALL, MUTED)}>{permission.reason}</p>;
  }

  const plan = planAmendment({
    lineData: row.lineData,
    storedTotal: row.totalAmount,
    storedHours: row.hours,
    lines: requestLines(draft),
    hours: numberOr(draft.hours),
    note: draft.note.trim() || null,
  });
  const preview = plan.ok ? describeAmendment(plan.plan) : null;
  const canSave = plan.ok && draft.reason.trim().length >= 3 && !saving && !stale;

  function update(key: string, patch: Partial<DraftLine>) {
    setDraft((current) => ({ ...current, lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) }));
    if (save.status === "saved") setSave({ status: "idle" });
  }

  function addLine() {
    setDraft((current) => ({ ...current, lines: [...current.lines, { key: `n${Date.now()}`, sourceIndex: null, description: "", quantity: "1", unitAmount: "", category: "LABOUR", removed: false }] }));
  }

  function startAgain() {
    setDraft(draftFrom(row));
    setSave({ status: "idle" });
  }

  async function submit() {
    if (!canSave) return;
    setSave({ status: "saving" });
    try {
      const response = await fetch(`/api/admin/cleaner-invoices/${encodeURIComponent(row.id)}/amend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestKey: draft.requestKey,
          expectedUpdatedAt: draft.baseUpdatedAt,
          expectedRevision: draft.baseRevision,
          reason: draft.reason.trim(),
          note: draft.note.trim() || null,
          hours: numberOr(draft.hours),
          lines: requestLines(draft),
        }),
      });
      const body = (await response.json().catch(() => null)) as (SaveResult & { error?: string }) | null;
      if (!response.ok || !body) {
        setSave({ status: "error", message: response.status === 403 && !body?.error ? "Your access does not allow amending this invoice." : body?.error ?? "The amendment was not saved.", stale: response.status === 409 });
        return;
      }
      setSave({ status: "saved", result: body });
      router.refresh();
    } catch {
      setSave({ status: "error", message: "No answer from the server. It may have been saved: press Save again (it will not amend twice) or reload to see.", stale: false });
    }
  }

  if (save.status === "saved") {
    const { result } = save;
    return (
      <div className="space-y-2" role="status">
        <EToneNotice tone="good" title={`Amendment ${result.revision} saved`}>
          <ul className="list-disc pl-5">
            {result.changes.map((change) => <li key={change}>{change}</li>)}
          </ul>
          <p className="mt-1">{noticeText(result.notice)}</p>
          {result.needsXeroUpdate ? <p className="mt-1 font-[600]">The bill in Xero still shows the old lines. Update it in Xero, then record that you did.</p> : null}
        </EToneNotice>
        <EButton size="sm" variant="outline" onClick={startAgain} className="max-sm:h-11">Amend again</EButton>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {permission.needsXeroUpdate ? (
        <EToneNotice tone="attention" title="This invoice is already a bill in Xero">
          Saving changes it here only. The Xero bill keeps the old lines until someone updates it in Xero; the invoice will say so until that is recorded.
        </EToneNotice>
      ) : null}
      {row.status === "APPROVED" ? <p className={cn(SMALL, MUTED)}>It stays approved: as the administrator amending it, you approve the new figures.</p> : null}
      {row.status === "SUBMITTED" ? <p className={cn(SMALL, MUTED)}>It stays submitted; an administrator still approves it.</p> : null}
      {stale ? (
        <EToneNotice tone="attention" title="This invoice changed since you started">
          Your draft is kept below, but it cannot be saved over a newer version.{" "}
          <button type="button" className="underline underline-offset-2" onClick={startAgain}>Start again from the current invoice</button>
        </EToneNotice>
      ) : null}
      <fieldset disabled={saving} className="space-y-3">
        <legend className="sr-only">Invoice lines</legend>
        <ul className="space-y-2">
          {draft.lines.map((line, index) => {
            const quantity = numberOr(line.quantity);
            const unit = numberOr(line.unitAmount);
            const amount = Number.isFinite(quantity) && Number.isFinite(unit) ? formatAud(lineAmount(quantity, unit)) : "–";
            return (
              <li key={line.key} className={cn("rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3", line.removed && "opacity-60")}>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_8rem_6.5rem] sm:items-end">
                  <EField label={line.sourceIndex === null ? `New line ${index + 1}` : `Line ${index + 1}`}>
                    <EInput value={line.description} disabled={line.removed} onChange={(event) => update(line.key, { description: event.target.value })} className="max-sm:text-[16px]" />
                  </EField>
                  <EField label="Qty or hours">
                    <EInput type="number" inputMode="decimal" min="0" step="0.25" value={line.quantity} disabled={line.removed} onChange={(event) => update(line.key, { quantity: event.target.value })} className="max-sm:text-[16px]" />
                  </EField>
                  <EField label="Unit amount (AUD)">
                    <EInput type="number" inputMode="decimal" step="0.01" value={line.unitAmount} disabled={line.removed} onChange={(event) => update(line.key, { unitAmount: event.target.value })} className="max-sm:text-[16px]" />
                  </EField>
                  <p className={cn(SMALL, "e-tnum sm:pb-2.5 sm:text-right", line.removed && "line-through")}>{amount}</p>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {line.sourceIndex === null ? (
                    <label className={cn(SMALL, "flex items-center gap-2")}>
                      <span className={MUTED}>Kind</span>
                      <ESelect value={line.category} onChange={(event) => update(line.key, { category: event.target.value as BillLineCategory })} className="h-9 w-auto max-sm:text-[16px]">
                        {(Object.keys(CATEGORY_LABEL) as BillLineCategory[]).map((category) => <option key={category} value={category}>{CATEGORY_LABEL[category]}</option>)}
                      </ESelect>
                    </label>
                  ) : null}
                  {line.sourceIndex === null ? (
                    <button type="button" className={cn(SMALL, "min-h-11 underline underline-offset-2 sm:min-h-0")} onClick={() => setDraft((current) => ({ ...current, lines: current.lines.filter((item) => item.key !== line.key) }))}>Delete new line</button>
                  ) : (
                    <button type="button" className={cn(SMALL, "min-h-11 underline underline-offset-2 sm:min-h-0")} aria-pressed={line.removed} onClick={() => update(line.key, { removed: !line.removed })}>
                      {line.removed ? "Keep this line" : "Remove this line"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <EButton type="button" size="sm" variant="outline" onClick={addLine} className="max-sm:h-11">Add a line</EButton>
        <p className={cn("text-[0.75rem]", MUTED)}>Removing a line does not hand its job back to the payee. To let them bill it again, send the invoice back for changes instead.</p>
        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <EField label="Hours on the invoice">
            <EInput type="number" inputMode="decimal" min="0" step="0.25" value={draft.hours} onChange={(event) => setDraft((current) => ({ ...current, hours: event.target.value }))} className="max-sm:text-[16px]" />
          </EField>
          <EField label="Note printed on the amended invoice (optional)">
            <EInput value={draft.note} maxLength={1000} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} className="max-sm:text-[16px]" />
          </EField>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={reasonId} className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Reason (required; the payee is told)</label>
          <ETextarea id={reasonId} value={draft.reason} maxLength={2000} onChange={(event) => setDraft((current) => ({ ...current, reason: event.target.value }))} className="max-sm:text-[16px]" />
        </div>
      </fieldset>
      <section aria-label="What the payee will be told" className="rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-sunken))] p-3">
        <p className={cn(SMALL, "font-[600]")}>What changes</p>
        {preview ? (
          <ul className={cn(SMALL, "mt-1 list-disc pl-5")}>
            {preview.map((change) => <li key={change}>{change}</li>)}
          </ul>
        ) : (
          <p className={cn(SMALL, MUTED)}>{plan.ok ? "" : plan.reason}</p>
        )}
        <p className={cn("mt-1 text-[0.75rem]", MUTED)}>The payee gets an in-app notice and an email (their own notification switches apply) listing these changes, the new total, your reason and a link to the amended invoice.</p>
      </section>
      {save.status === "error" ? (
        <p role="alert" className={cn(SMALL, "text-[hsl(var(--e-danger))]")}>
          {save.message}
          {save.stale ? <> <button type="button" className="underline underline-offset-2" onClick={() => router.refresh()}>Reload the invoice</button></> : null}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <EButton type="button" variant="primary" size="sm" disabled={!canSave} onClick={submit} className="max-sm:h-11">
          {saving ? "Saving…" : "Save amendment and tell the payee"}
        </EButton>
        {draft.reason.trim().length < 3 ? <span className={cn("text-[0.75rem]", MUTED)}>Write the reason to save.</span> : null}
      </div>
    </div>
  );
}
