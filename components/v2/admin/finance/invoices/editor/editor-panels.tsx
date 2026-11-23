"use client";

/**
 * The right-hand Send, Xero and History cards. Each states only what is stored
 * or configured. Send options (Wave D) are explicit request fields: "Attach
 * PDF" is always on, "Include payment link" only when the existing pay route
 * could work (otherwise disabled with the reason), "Push to Xero when sent"
 * runs the existing idempotent push after a successful send.
 */
import Link from "next/link";
import { tourTarget } from "@/lib/tutorials/targets";
import { formatInTimeZone } from "date-fns-tz";
import { EButton, ECard, EEyebrow } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import type { ClientInvoiceEditorData, EditorXeroAccounts, EditorXeroUpdate, HistoryEntry } from "@/lib/billing/client-invoice-editor-types";
import { XERO_LINE_CHANGE_LABEL } from "@/lib/billing/client-invoice-xero-update-rules";
import { xeroDisplay } from "@/lib/billing/client-invoice-xero-display";

const LABEL = "block text-[0.6875rem] font-[600] text-[hsl(var(--e-text-secondary))]";
const MUTED = "text-[0.75rem] text-[hsl(var(--e-muted-foreground))]";

function when(iso: string | null, timezone: string): string {
  if (!iso) return "—";
  try {
    return formatInTimeZone(new Date(iso), timezone, "d MMM yyyy, HH:mm");
  } catch {
    return iso;
  }
}

export type SendChoices = { includePaymentLink: boolean; pushToXero: boolean };

function OptionRow({ id, label, checked, disabled, hint, onChange }: { id: string; label: string; checked: boolean; disabled: boolean; hint?: string | null; onChange?: (value: boolean) => void }) {
  return (
    <div>
      <label htmlFor={id} className="inline-flex min-h-11 items-center gap-2 text-[0.8125rem] sm:min-h-8">
        <input
          id={id}
          type="checkbox"
          className="h-[15px] w-[15px] accent-[hsl(var(--e-primary))]"
          checked={checked}
          disabled={disabled}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(event) => onChange?.(event.target.checked)}
        />
        {label}
      </label>
      {hint ? <p id={`${id}-hint`} className={MUTED}>{hint}</p> : null}
    </div>
  );
}

export function SendCard({
  data,
  to,
  onTo,
  choices,
  onChoices,
  canSend,
  resend,
  disabled,
  disabledReason,
  onSend,
}: {
  data: ClientInvoiceEditorData;
  to: string;
  onTo: (value: string) => void;
  choices: SendChoices;
  onChoices: (choices: SendChoices) => void;
  canSend: boolean;
  resend: boolean;
  disabled: boolean;
  disabledReason: string | null;
  onSend: () => void;
}) {
  const { send } = data;
  const inXero = Boolean(data.row.xeroInvoiceId);
  return (
    <ECard className="space-y-2.5 px-4 py-3.5">
      <EEyebrow>Send</EEyebrow>
      {canSend ? (
        <>
          <div>
            <label htmlFor="invoice-send-to" className={LABEL}>
              To
            </label>
            <input
              id="invoice-send-to"
              type="email"
              value={to}
              onChange={(event) => onTo(event.target.value)}
              disabled={disabled}
              aria-describedby="invoice-send-to-hint"
              className="mt-1 h-11 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[1rem] focus:border-[hsl(var(--e-gold))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--e-ring))] disabled:opacity-60 sm:h-9 sm:text-[0.8125rem]"
            />
            <p id="invoice-send-to-hint" className={`mt-1 ${MUTED}`}>
              {send.recipientsError
                ? `Leave blank to use the client's invoice contacts (they could not be read: ${send.recipientsError}).`
                : send.defaultRecipients.length
                  ? `Leave blank to send to the client's invoice contacts: ${send.defaultRecipients.join(", ")}.`
                  : "The client has no invoice contact on file, so enter an address."}
            </p>
          </div>
          <OptionRow id="invoice-send-pdf" label="Attach PDF" checked disabled hint={null} />
          <OptionRow
            id="invoice-send-pay-link"
            label="Include payment link"
            checked={send.paymentLink.available && choices.includePaymentLink}
            disabled={disabled || !send.paymentLink.available}
            hint={send.paymentLink.available ? "Links to the client's invoices page, where Pay now opens a card payment for what is owed." : send.paymentLink.reason}
            onChange={(value) => onChoices({ ...choices, includePaymentLink: value })}
          />
          <OptionRow
            id="invoice-send-xero"
            label="Push to Xero when sent"
            checked={!inXero && choices.pushToXero}
            disabled={disabled || inXero}
            hint={inXero ? "Already in Xero." : "Runs the usual push after the email is accepted. A failed push never undoes the send; it is shown and kept for Retry."}
            onChange={(value) => onChoices({ ...choices, pushToXero: value })}
          />
          <EButton {...tourTarget("admin.finance.invoice.send")} type="button" size="sm" variant="outline" disabled={disabled} onClick={onSend} title={disabledReason ?? undefined}>
            {resend ? "Review and re-send…" : "Review and send…"}
          </EButton>
          {disabledReason ? <p className={MUTED}>{disabledReason}</p> : null}
        </>
      ) : (
        <p className={MUTED}>
          {data.row.status === "VOID" ? "A void invoice cannot be sent." : "A paid invoice is not sent again from here."}
        </p>
      )}
    </ECard>
  );
}

function xeroStateText(data: ClientInvoiceEditorData): React.ReactNode {
  const { xero } = data;
  if (!xero.xeroInvoiceId && xero.state !== "PENDING" && xero.exportedAt) {
    return <span>Exported {when(xero.exportedAt, data.timezone)}, but no Xero invoice id is stored</span>;
  }
  const view = xeroDisplay(data.row);
  if (view.key === "none") return <span>Not pushed</span>;
  return (
    <>
      <EPill tone={view.tone}>{view.label}</EPill>
      {view.key === "unchecked" && xero.exportedAt ? <span className={MUTED}> pushed {when(xero.exportedAt, data.timezone)}</span> : null}
      {view.checkedAt ? (
        <span className={`block ${MUTED}`}>
          {view.key === "failed" ? "Failed" : "Last checked"} {when(view.checkedAt, data.timezone)}
        </span>
      ) : null}
      {view.reason ? <span className={`block ${MUTED}`}>{view.reason}</span> : null}
      {data.row.xeroSync?.xeroStatus ? (
        <span className={`block ${MUTED}`}>
          Xero status{view.key === "unknown" ? " at the last successful check" : ""}: {data.row.xeroSync.xeroStatus.toLowerCase()}
        </span>
      ) : null}
    </>
  );
}

export type XeroRefreshState = { status: "idle" } | { status: "running" } | { status: "done"; message: string; ok: boolean };

/** The last "Update in Xero" stored on the invoice, in words (organisation timezone). */
function xeroUpdateLastText(update: EditorXeroUpdate, timezone: string): { text: string; failed: boolean } | null {
  if (update.inFlight) return { text: "An update is with Xero now.", failed: false };
  const last = update.last;
  if (!last) return null;
  if (last.state === "FAILED") {
    const before = last.lastSuccessAt ? ` Last successful update ${when(last.lastSuccessAt, timezone)}.` : "";
    return { text: `Last update failed ${when(last.at, timezone)}: ${last.reason ?? "no reason was recorded"}. Nothing was changed here.${before}`, failed: true };
  }
  if (last.state === "DONE" && last.lastSuccessAt) {
    const change = last.change ? ` (${XERO_LINE_CHANGE_LABEL[last.change]})` : "";
    return { text: `Last updated in Xero ${when(last.lastSuccessAt, timezone)}${change}.`, failed: false };
  }
  return null;
}

function XeroUpdateControl({
  data,
  disabled,
  disabledReason,
  onUpdate,
}: {
  data: ClientInvoiceEditorData;
  disabled: boolean;
  disabledReason: string | null;
  onUpdate: () => void;
}) {
  const update = data.xero.update;
  if (!update || !data.xero.xeroInvoiceId) return null;
  const last = xeroUpdateLastText(update, data.timezone);
  const name = data.row.kind === "CREDIT_NOTE" ? "credit note" : "invoice";
  const blocked = disabled || update.inFlight || Boolean(disabledReason);
  return (
    <div className="space-y-1.5 border-t border-[hsl(var(--e-border))] pt-2.5">
      {update.available ? (
        <>
          <EButton type="button" size="sm" variant="outline" disabled={blocked} title={disabledReason ?? undefined} onClick={onUpdate}>
            Update in Xero
          </EButton>
          <p className={MUTED}>
            Re-sends these lines to the same Xero {name}, grouped by property like the PDF. It never creates a second {name} and never changes an amount here.
            {disabledReason ? ` ${disabledReason}` : ""}
          </p>
        </>
      ) : (
        <p className={MUTED}>Update in Xero is not available: {update.reason}</p>
      )}
      {last ? (
        <p className={last.failed ? "text-[0.75rem] text-[hsl(var(--e-danger))]" : MUTED}>{last.text}</p>
      ) : null}
    </div>
  );
}

const SETTINGS_XERO_HREF = "/v2/admin/settings?tab=xero";

/**
 * Which Xero account each kind of line on this invoice goes to, from Settings ›
 * Money › Xero › Client invoices (2026-11-23), or why a push is refused. An
 * empty optional account says which account its lines use instead.
 */
function InvoiceAccounts({ accounts }: { accounts: EditorXeroAccounts }) {
  if (accounts.status === "error") {
    return <span role="alert" className="text-[hsl(var(--e-danger))]">The Xero accounts could not be read: {accounts.message}</span>;
  }
  if (accounts.status === "not-set") {
    return (
      <span className="block text-[hsl(var(--e-danger))]">
        Not chosen. Push to Xero, Update in Xero and the CSV export are refused until an administrator chooses the sales account in{" "}
        <Link href={SETTINGS_XERO_HREF} className="underline underline-offset-2">
          Settings › Money › Xero
        </Link>
        . Nothing is sent to a default account.
      </span>
    );
  }
  // One reason for every unnamed account (e.g. "Xero is not connected.") is said once, under the list.
  const unnamedReasons = new Set(accounts.groups.filter((group) => group.code && !group.name).map((group) => group.nameReason ?? ""));
  const sharedReason = unnamedReasons.size === 1 ? Array.from(unnamedReasons)[0] : null;
  return (
    <>
      <ul className="space-y-1">
        {accounts.groups.map((group) => (
          <li key={group.label}>
            <span className="text-[hsl(var(--e-text-secondary))]">{group.label}:</span>{" "}
            {group.code ? (
              <>
                <span className="e-tnum">{group.code}</span>
                {group.name ? ` · ${group.name}` : " · name unavailable"}
              </>
            ) : (
              <span className="text-[hsl(var(--e-danger))]">no account, so the push will be refused</span>
            )}
            {group.fallback ? <span className={`block ${MUTED}`}>{group.fallback}</span> : null}
            {group.code && !group.name && group.nameReason && sharedReason === null ? <span className={`block ${MUTED}`}>{group.nameReason}</span> : null}
            {group.refusal ? <span className={`block ${MUTED}`}>{group.refusal}</span> : null}
          </li>
        ))}
      </ul>
      {sharedReason ? <span className={`mt-1 block ${MUTED}`}>Account names: {sharedReason}</span> : null}
      {accounts.salesNeedsConfirmation ? (
        <span className={`mt-1 block ${MUTED}`}>
          The sales account {accounts.salesCode} was stored before accounts had to be chosen. It is still used; confirm or change it in{" "}
          <Link href={SETTINGS_XERO_HREF} className="underline underline-offset-2">
            Settings › Money › Xero
          </Link>
          .
        </span>
      ) : null}
    </>
  );
}

/** The single-account line older data shows (practice samples without the accounts view). */
function LegacyAccount({ data }: { data: ClientInvoiceEditorData }) {
  const { xero } = data;
  return (
    <>
      {xero.salesAccountCode
        ? xero.salesAccountName
          ? `${xero.salesAccountCode} · ${xero.salesAccountName}`
          : `${xero.salesAccountCode} · name unavailable`
        : "Not chosen"}
      {xero.salesAccountCode && !xero.salesAccountName && xero.salesAccountNameReason ? (
        <span className={`block ${MUTED}`}>{xero.salesAccountNameReason}</span>
      ) : null}
      {xero.hasDisbursementLines ? (
        <span className={`block ${MUTED}`}>
          Shopping disbursements: {xero.disbursementAccountCode ?? "no account set, so the push will be refused"}
        </span>
      ) : null}
    </>
  );
}

export function XeroCard({
  data,
  onRefresh,
  refresh,
  disabled,
  onUpdate,
  updateDisabledReason = null,
}: {
  data: ClientInvoiceEditorData;
  /** "Refresh from Xero" for this invoice; omitted when it cannot be checked. */
  onRefresh?: () => void;
  refresh?: XeroRefreshState;
  disabled?: boolean;
  /** "Update in Xero" (2026-11-18); omitted where the action is not offered (practice). */
  onUpdate?: () => void;
  updateDisabledReason?: string | null;
}) {
  const { xero } = data;
  const checkable = Boolean(xero.xeroInvoiceId) && data.row.status !== "VOID" && !(data.row.kind === "INVOICE" && data.row.status === "PAID");
  return (
    <ECard className="space-y-2.5 px-4 py-3.5">
      <EEyebrow>Xero</EEyebrow>
      <dl className="grid grid-cols-[80px_1fr] gap-x-2.5 gap-y-1.5 text-[0.8125rem]">
        <dt className="text-[hsl(var(--e-muted-foreground))]">Contact</dt>
        <dd className="min-w-0 break-words">
          {xero.contactId ? (
            <>
              {data.row.client.name} <EPill tone="ok">Linked</EPill>
            </>
          ) : (
            <span>Not linked yet. The first push links a Xero contact.</span>
          )}
        </dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Account</dt>
        <dd className="min-w-0 break-words">
          {xero.accounts ? <InvoiceAccounts accounts={xero.accounts} /> : <LegacyAccount data={data} />}
        </dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">State</dt>
        <dd className="min-w-0">{xeroStateText(data)}</dd>
      </dl>
      {xero.settingsError ? <p className={MUTED}>Xero settings could not be read: {xero.settingsError}</p> : null}
      <p className={MUTED}>
        {data.row.kind === "CREDIT_NOTE"
          ? "After pushing, Xero is read back automatically every hour. A credit note is never paid here; the check confirms Xero agrees."
          : "After pushing, payments recorded in Xero come back here automatically (read every hour); anything that does not match is left for review."}
        {xero.xeroInvoiceId
          ? data.row.xeroSync
            ? ` Last check ${when(data.row.xeroSync.checkedAt, data.timezone)}: ${xeroDisplay(data.row).label.toLowerCase()}.`
            : " Not checked yet."
          : ""}
      </p>
      {checkable && onRefresh ? (
        <EButton type="button" size="sm" variant="outline" disabled={disabled || refresh?.status === "running"} onClick={onRefresh}>
          {refresh?.status === "running" ? "Checking Xero…" : "Refresh from Xero"}
        </EButton>
      ) : null}
      {refresh?.status === "done" ? (
        <p role="status" className={refresh.ok ? MUTED : "text-[0.75rem] text-[hsl(var(--e-danger))]"}>
          {refresh.message}
        </p>
      ) : null}
      {onUpdate ? <XeroUpdateControl data={data} disabled={Boolean(disabled)} disabledReason={updateDisabledReason} onUpdate={onUpdate} /> : null}
    </ECard>
  );
}

function HistoryItem({ entry, timezone }: { entry: HistoryEntry; timezone: string }) {
  return (
    <li className="text-[0.8125rem]">
      <span className="e-tnum text-[hsl(var(--e-muted-foreground))]">{when(entry.at, timezone)}</span>{" "}
      <span className="break-words">{entry.label}</span>
      {entry.actor ? <span className="text-[hsl(var(--e-muted-foreground))]"> by {entry.actor}</span> : null}
    </li>
  );
}

export function HistoryCard({ data }: { data: ClientInvoiceEditorData }) {
  return (
    <ECard className="space-y-2.5 px-4 py-3.5">
      <EEyebrow>History</EEyebrow>
      {data.history.length ? (
        <ul className="space-y-1.5">
          {data.history.map((entry) => (
            <HistoryItem key={entry.id} entry={entry} timezone={data.timezone} />
          ))}
        </ul>
      ) : (
        <p className={MUTED}>Nothing recorded yet.</p>
      )}
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Payments, reversals, voids and started-work reviews are recorded with who did them. Sends, Xero pushes and Xero checks
        that changed something are recorded too. Line edits and approval are not audited; only the dates the invoice stores are shown.
      </p>
    </ECard>
  );
}
