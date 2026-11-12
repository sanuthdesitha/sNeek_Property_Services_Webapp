"use client";

/**
 * The quote page's right rail below the add-on requests: Status and details
 * (status, valid until, notes), Convert to job (date and button, offered
 * once won), Send and share, and the activity timeline.
 */
import * as React from "react";
import { RotateCcw } from "lucide-react";
import { EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import QuoteTimeline from "@/components/v2/admin/quotes/quote-timeline";
import { QUOTE_PAGE_STATUSES, QUOTE_STATUS_LABEL, type QuotePageStatus } from "@/lib/quotes/quote-page-actions";

function RailCard({ title, id, children, aside }: { title: string; id?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} id={id} className="scroll-mt-20">
      <ECard>
        <ECardBody className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 id={headingId} className="text-[0.6875rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-gold-ink))]">{title}</h2>
            {aside}
          </div>
          {children}
        </ECardBody>
      </ECard>
    </section>
  );
}

export type StatusCardProps = {
  isNew: boolean;
  status: QuotePageStatus;
  onStatusChange: (status: QuotePageStatus) => void;
  validUntil: string;
  onValidUntil: (value: string) => void;
  notes: string;
  onNotes: (value: string) => void;
  onRegenerateNotes: (() => void) | null;
  saving: boolean;
  saveLabel: string;
  onSave: (() => void) | null;
  savedLine: string;
};

export function StatusCard(props: StatusCardProps) {
  return (
    <RailCard
      title="Status and details"
      aside={props.onSave ? <EButton size="sm" variant="ghost" onClick={props.onSave} disabled={props.saving}>{props.saving ? "Saving…" : props.saveLabel}</EButton> : null}
    >
      <fieldset disabled={props.saving} className="min-w-0 space-y-3">
        <EField label="Status" hint={props.isNew ? "A new quote is saved as a draft." : "Changes save with Save."}>
          <ESelect value={props.status} disabled={props.isNew} onChange={(e) => props.onStatusChange(e.target.value as QuotePageStatus)}>
            {QUOTE_PAGE_STATUSES.map((s) => <option key={s} value={s}>{QUOTE_STATUS_LABEL[s]}</option>)}
          </ESelect>
        </EField>
        <EField label="Valid until">
          <EInput type="date" value={props.validUntil} onChange={(e) => props.onValidUntil(e.target.value)} />
        </EField>
        <EField
          label={
            <span className="flex items-center justify-between gap-2">
              <span>Notes on the quote (the client sees these)</span>
              {props.onRegenerateNotes ? (
                <button type="button" onClick={props.onRegenerateNotes} className="inline-flex min-h-[28px] items-center gap-1 text-[0.6875rem] font-medium text-[hsl(var(--e-gold-ink))] hover:underline">
                  <RotateCcw className="h-3 w-3" aria-hidden /> Regenerate
                </button>
              ) : null}
            </span>
          }
        >
          <ETextarea value={props.notes} onChange={(e) => props.onNotes(e.target.value)} placeholder="Scope, inclusions, exclusions…" />
        </EField>
      </fieldset>
      <p role="status" className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{props.savedLine}</p>
    </RailCard>
  );
}

export function ConvertCard({ enabled, reason, addressLine, onConvert }: { enabled: boolean; reason: string | null; addressLine: string; onConvert: (date: string) => void }) {
  const [date, setDate] = React.useState("");
  return (
    <RailCard title="Convert to job" id="convert">
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        {reason ?? `Creates the job${addressLine ? ` at ${addressLine}` : ""} with these lines. You choose or create the property next.`}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <EField label="Scheduled date" className="min-w-[10rem] flex-1">
          <EInput type="date" value={date} disabled={!enabled} onChange={(e) => setDate(e.target.value)} />
        </EField>
        <EButton size="sm" disabled={!enabled} onClick={() => onConvert(date)} title={reason ?? undefined}>Convert to job</EButton>
      </div>
    </RailCard>
  );
}

export type ShareCardProps = {
  busy: string | null;
  disabledReason: string | null;
  onPreview: () => void;
  onEmailPreview: () => void;
  onExport: () => void;
  onCopyLink: () => void;
  onResend: (() => void) | null;
};

export function ShareCard(props: ShareCardProps) {
  const off = Boolean(props.disabledReason) || Boolean(props.busy);
  return (
    <RailCard title="Send and share">
      <div className="flex flex-wrap gap-2">
        <EButton size="sm" variant="outline" onClick={props.onPreview} disabled={off}>{props.busy === "pdf" ? "Rendering…" : "Preview"}</EButton>
        <EButton size="sm" variant="outline" onClick={props.onEmailPreview} disabled={off}>Email preview</EButton>
        <EButton size="sm" variant="outline" onClick={props.onExport} disabled={off}>Export PDF</EButton>
        <EButton size="sm" variant="outline" onClick={props.onCopyLink} disabled={off}>Copy public link</EButton>
        {props.onResend ? <EButton size="sm" variant="outline" onClick={props.onResend} disabled={off}>Resend</EButton> : null}
      </div>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        {props.disabledReason ?? "Shows the last saved version. Copying the link of a draft marks it Sent (the client can open it)."}
      </p>
    </RailCard>
  );
}

export function ActivityCard({ quoteId, timezone }: { quoteId: string; timezone: string }) {
  return <QuoteTimeline quoteId={quoteId} timezone={timezone} />;
}
