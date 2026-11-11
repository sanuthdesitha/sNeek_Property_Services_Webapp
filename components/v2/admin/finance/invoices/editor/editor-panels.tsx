"use client";

/**
 * The right-hand Send, Xero and History cards. Each states only what is stored
 * or configured; options the send service does not support (payment link,
 * push to Xero on send) are not offered.
 */
import { formatInTimeZone } from "date-fns-tz";
import { EButton, ECard, EEyebrow } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import type { ClientInvoiceEditorData, HistoryEntry } from "@/lib/billing/client-invoice-editor-types";

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

export function SendCard({
  data,
  to,
  onTo,
  canSend,
  resend,
  disabled,
  disabledReason,
  onSend,
}: {
  data: ClientInvoiceEditorData;
  to: string;
  onTo: (value: string) => void;
  canSend: boolean;
  resend: boolean;
  disabled: boolean;
  disabledReason: string | null;
  onSend: () => void;
}) {
  const { send } = data;
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
          <p className={MUTED}>The PDF is attached to every invoice email. Sending does not push to Xero.</p>
          <EButton type="button" size="sm" variant="outline" disabled={disabled} onClick={onSend} title={disabledReason ?? undefined}>
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
  if (xero.xeroInvoiceId) {
    return (
      <>
        <EPill tone="ok">In Xero</EPill> <span className={MUTED}>since {when(xero.exportedAt, data.timezone)}</span>
      </>
    );
  }
  if (xero.state === "PENDING") return <EPill tone="bad">Pending or failed: retry the push</EPill>;
  if (xero.exportedAt) return <span>Exported {when(xero.exportedAt, data.timezone)}, but no Xero invoice id is stored</span>;
  return <span>Not pushed</span>;
}

export function XeroCard({ data }: { data: ClientInvoiceEditorData }) {
  const { xero } = data;
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
          {xero.salesAccountCode ? `${xero.salesAccountCode} (sales account in Xero settings)` : "Unknown"}
          {xero.hasDisbursementLines ? (
            <span className={`block ${MUTED}`}>
              Shopping disbursements: {xero.disbursementAccountCode ?? "no account set, so the push will be refused"}
            </span>
          ) : null}
        </dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">State</dt>
        <dd className="min-w-0">{xeroStateText(data)}</dd>
      </dl>
      {xero.settingsError ? <p className={MUTED}>Xero settings could not be read: {xero.settingsError}</p> : null}
      <p className={MUTED}>Payments made in Xero are not read back yet. Record them here.</p>
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
        Payments, reversals, voids and started-work reviews are recorded with who did them. Line edits, approval, sending and
        Xero pushes are not audited; only the dates the invoice stores are shown.
      </p>
    </ECard>
  );
}
