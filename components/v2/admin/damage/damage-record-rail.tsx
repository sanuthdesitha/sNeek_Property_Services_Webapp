"use client";

/**
 * The decision rail of the damage report page: Your decision (three plain
 * choices while under review), Tell the client (the release message and its
 * transports, chosen explicitly), What the client will see (with Preview)
 * and Linked records.
 */
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EToneCard } from "@/components/v2/ui/tone-band";
import { FoldSection } from "@/components/v2/admin/maintenance/detail-sections";
import type { DamageReleaseNoticePreview, DamageReleaseTransport } from "@/lib/damage/release-notice-types";
import type { DamageRecordContext } from "@/lib/damage/record-model";
import type { RecordReport } from "./damage-record-api";
import { dayOnly, dayTime, firstName } from "./damage-record-format";

export type DecisionKey = "release" | "close" | "send-back" | "take-back" | "close-released" | "reopen";

type DecisionOption = { key: DecisionKey; label: string; detail: string };

export type DecisionModel = {
  title: string;
  sub: string;
  pill: string;
  tone: "attention" | "good" | "info" | null;
  options: DecisionOption[];
  confirmLabel: Record<DecisionKey, string>;
};

/** Which choices the report's state allows (every one maps to an existing server change). */
export function decisionModel(report: RecordReport, context: DamageRecordContext): DecisionModel {
  const cases = report.items.filter((item) => item.caseId).length;
  const cleaner = firstName(report.reportedByName);
  const confirmLabel: Record<DecisionKey, string> = {
    release: "Release to client…",
    close: "Close without releasing…",
    "send-back": "Send back to the cleaner…",
    "take-back": "Take back from the client…",
    "close-released": "Close…",
    reopen: "Reopen for review…",
  };
  const sendBack: DecisionOption = { key: "send-back", label: "Send back to the cleaner", detail: `Photos or details are wrong. Your PIN and a reason ${cleaner} will read.` };
  if (report.status === "DRAFT") {
    return { title: "Sent back to the cleaner", sub: `Waiting for ${cleaner} to correct and resubmit it`, pill: "With the cleaner", tone: "info", options: [], confirmLabel };
  }
  if (report.status === "CLOSED") {
    return {
      title: "Closed",
      sub: report.clientVisible ? "Closed and still visible to the client" : "Closed without releasing; kept internal",
      pill: "Closed",
      tone: null,
      options: [
        { key: "reopen", label: "Reopen for review", detail: report.clientVisible ? "Back under review; the client keeps seeing it until you take it back." : "Back under review, still hidden from the client." },
        ...(report.clientVisible ? [{ key: "take-back" as const, label: "Take back from the client", detail: "It and its cases disappear from their portal. A message already sent cannot be unsent." }] : []),
      ],
      confirmLabel,
    };
  }
  if (report.clientVisible) {
    return {
      title: "Your decision",
      sub: report.acknowledgedAt ? `Acknowledged by "${report.acknowledgedName ?? "the client"}"` : "Released; waiting for the client to acknowledge",
      pill: report.acknowledgedAt ? "Acknowledged" : "Released",
      tone: "good",
      options: [
        { key: "take-back", label: "Take back from the client", detail: "It and its cases disappear from their portal. A message already sent cannot be unsent." },
        { key: "close-released", label: "Close", detail: "Finished: it stays in their portal and on the property's history." },
        sendBack,
      ],
      confirmLabel,
    };
  }
  return {
    title: "Your decision",
    sub: "Nothing has gone to the client yet",
    pill: "Review",
    tone: "attention",
    options: [
      { key: "release", label: "Release to the client", detail: `The report and its ${cases} case${cases === 1 ? "" : "s"} appear in their portal. Costs and internal notes never do. They can acknowledge it.` },
      { key: "close", label: "Close without releasing", detail: "For wear and tear the client does not need to see. Stays on the property's history." },
      sendBack,
    ],
    confirmLabel,
  };
}

export function DecisionCard({
  report,
  context,
  timeZone,
  model,
  choice,
  busy,
  onChoice,
  onConfirm,
}: {
  report: RecordReport;
  context: DamageRecordContext;
  timeZone: string;
  model: DecisionModel;
  choice: DecisionKey | null;
  busy: boolean;
  onChoice: (key: DecisionKey) => void;
  onConfirm: (key: DecisionKey) => void;
}) {
  const active = choice && model.options.some((option) => option.key === choice) ? choice : model.options[0]?.key ?? null;
  const groupName = React.useId();
  return (
    <EToneCard
      tone={model.tone}
      pill={model.pill}
      header={(
        <>
          <h2 className="text-[0.9375rem] font-[650]">{model.title}</h2>
          <p className="text-[0.75rem] opacity-80">{model.sub}</p>
        </>
      )}
      bodyClassName="space-y-2.5"
    >
      {report.clientVisible && context.lastRelease ? (
        <p className="text-[0.8125rem]">
          Released {dayTime(context.lastRelease.at, timeZone) ?? "(time not recorded)"}{context.lastRelease.byName ? ` by ${context.lastRelease.byName}` : ""} · {context.lastRelease.message ? `client message: ${context.lastRelease.message}` : "no client message"}.
          {report.acknowledgedAt ? <> <b className="font-[600]">Acknowledged</b> by &ldquo;{report.acknowledgedName ?? "the client"}&rdquo; {dayTime(report.acknowledgedAt, timeZone)} in the portal.</> : null}
          {context.verification ? <> PDF check code <span className="font-mono">{context.verification.code}</span> issued {dayOnly(context.verification.issuedAt, timeZone)}.</> : null}
        </p>
      ) : null}
      {report.acknowledgedAt ? <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">The typed name is kept as written.</p> : null}
      {model.options.length > 0 ? (
        <fieldset disabled={busy} className="space-y-2">
          <legend className="sr-only">Choose what happens next</legend>
          {model.options.map((option) => (
            <label
              key={option.key}
              className={cn(
                "flex min-h-11 cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2.5",
                active === option.key ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))]" : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]",
              )}
            >
              <input type="radio" name={groupName} value={option.key} checked={active === option.key} onChange={() => onChoice(option.key)} className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--e-primary))]" />
              <span className="min-w-0">
                <span className="block text-[0.875rem] font-[600]">{option.label}</span>
                <span className="block text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{option.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {active ? (
        <EButton type="button" className="w-full" variant={active === "send-back" ? "outline" : "primary"} disabled={busy} onClick={() => onConfirm(active)} aria-haspopup="dialog">
          {model.confirmLabel[active]}
        </EButton>
      ) : null}
    </EToneCard>
  );
}

export type NoticeState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; notice: DamageReleaseNoticePreview };

export function transportAvailability(notice: DamageReleaseNoticePreview): Record<DamageReleaseTransport, string | null> {
  const off = new Set(notice.switchedOff);
  const block = notice.refusal;
  return {
    INBOX: block ?? (off.has("INBOX") ? "switched off in Notifications" : null),
    EMAIL: block ?? (off.has("EMAIL") ? "switched off in Notifications" : notice.recipients.some((recipient) => recipient.hasEmail) ? null : "no email address on the client's login"),
    SMS: block ?? (off.has("SMS") ? "switched off in Notifications" : notice.smsConfigured === false ? "not set up for this organisation" : notice.recipients.some((recipient) => recipient.hasPhone) ? null : "no mobile number on the client's login"),
  };
}

export function TellClientCard({
  state,
  transports,
  busy,
  onToggle,
  onRetry,
}: {
  state: NoticeState;
  transports: DamageReleaseTransport[];
  busy: boolean;
  onToggle: (transport: DamageReleaseTransport, on: boolean) => void;
  onRetry: () => void;
}) {
  const notice = state.status === "ready" ? state.notice : null;
  const availability = notice ? transportAvailability(notice) : null;
  const emailName = notice?.recipients.find((recipient) => recipient.hasEmail)?.name ?? notice?.clientName ?? "the client";
  const labels: Record<DamageReleaseTransport, string> = {
    INBOX: "Portal inbox",
    EMAIL: notice && notice.recipients.length > 1 ? `Email to ${notice.recipients.length} client logins` : `Email to ${emailName}`,
    SMS: "SMS",
  };
  return (
    <EToneCard
      tone="info"
      pill="new"
      header={(
        <>
          <h2 className="text-[0.9375rem] font-[650]">Tell the client</h2>
          <p className="text-[0.75rem] opacity-80">When you release</p>
        </>
      )}
      bodyClassName="space-y-2.5 text-[0.8125rem]"
    >
      <p>Without a message the client only finds the report in Cases. Choose how the notification pipeline tells them:</p>
      {state.status === "loading" ? <p role="status" className="text-[hsl(var(--e-text-secondary))]">Preparing the message…</p> : null}
      {state.status === "error" ? (
        <p role="alert" className="text-[hsl(var(--e-danger))]">
          {state.message} <button type="button" className="min-h-8 underline max-sm:min-h-11" onClick={onRetry}>Try again</button>
        </p>
      ) : null}
      {notice && availability ? (
        <>
          {notice.refusal ? <p role="status" className="font-[550]">{notice.refusal} Releasing sends no message.</p> : null}
          <fieldset disabled={busy} className="flex flex-wrap gap-x-4 gap-y-1">
            <legend className="sr-only">Transports</legend>
            {(["INBOX", "EMAIL", "SMS"] as const).map((transport) => (
              <label key={transport} className="flex min-h-8 items-center gap-1.5 max-sm:min-h-11" title={availability[transport] ?? undefined}>
                <input
                  type="checkbox"
                  checked={transports.includes(transport)}
                  disabled={Boolean(availability[transport])}
                  onChange={(event) => onToggle(transport, event.target.checked)}
                  className="h-4 w-4 accent-[hsl(var(--e-primary))]"
                />
                <span className={cn(availability[transport] && "text-[hsl(var(--e-text-faint))]")}>{labels[transport]}</span>
              </label>
            ))}
          </fieldset>
          {(["EMAIL", "SMS"] as const).filter((transport) => availability[transport] && !notice.refusal).map((transport) => (
            <p key={transport} className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{transport === "EMAIL" ? "Email" : "SMS"}: {availability[transport]}.</p>
          ))}
          <div className="rounded-[10px] border border-dashed border-[hsl(var(--e-border-strong))] p-3">
            <p className="font-[650] [overflow-wrap:anywhere]">{notice.title}</p>
            <p className="mt-1 text-[hsl(var(--e-text-secondary))] [overflow-wrap:anywhere]">{notice.body}</p>
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Shown as &ldquo;queued&rdquo;, then &ldquo;sent&rdquo;; never &ldquo;read&rdquo; unless the client acknowledges.</p>
        </>
      ) : null}
    </EToneCard>
  );
}

export function ClientViewCard({ caseCount, onPreview }: { caseCount: number; onPreview: () => void }) {
  return (
    <FoldSection
      id="d-client-view"
      title="What the client will see"
      summary="Items, photos and repair status; never estimates"
      action={<button type="button" onClick={onPreview} className="min-h-8 text-[0.8125rem] text-[hsl(var(--e-primary))] underline max-sm:min-h-11" aria-haspopup="dialog">Preview</button>}
    >
      <p className="text-[0.8125rem]">
        {caseCount} item{caseCount === 1 ? "" : "s"} with photos, area, severity and cause · repair status read live from each case · the acknowledge box (typed name). <b className="font-[600]">Not shown:</b> estimates, internal notes, send-back history.
      </p>
    </FoldSection>
  );
}

export function LinkedRecordsCard({ report, context, timeZone }: { report: RecordReport; context: DamageRecordContext; timeZone: string }) {
  const cases = report.items.flatMap((item, index) => (item.caseId ? [{ id: item.caseId, number: index + 1 }] : []));
  const repairs = report.items.flatMap((item) => item.maintenance.map((repair) => ({ id: repair.id, title: repair.title })));
  const rows: Array<{ key: string; label: string; href: string }> = [
    { key: "job", label: `Clean ${context.job.jobNumber ?? ""} · ${dayOnly(context.job.scheduledDate, timeZone) ?? "date not recorded"}${report.reportedByName ? ` · ${report.reportedByName}` : ""}`, href: `/v2/admin/jobs/${encodeURIComponent(context.job.id)}` },
    { key: "property", label: `Property · ${context.property.name}`, href: `/v2/admin/properties/${encodeURIComponent(context.property.id)}` },
    ...(context.client ? [{ key: "client", label: `Client · ${context.client.name}`, href: `/v2/admin/clients/${encodeURIComponent(context.client.id)}` }] : []),
    ...cases.map((entry) => ({ key: `case-${entry.id}`, label: `Case for item ${entry.number}`, href: `/v2/admin/cases?open=${encodeURIComponent(entry.id)}` })),
    ...repairs.map((repair) => ({ key: `repair-${repair.id}`, label: `Maintenance · ${repair.title}`, href: `/v2/admin/maintenance/${encodeURIComponent(repair.id)}` })),
  ];
  return (
    <FoldSection id="d-linked" title="Linked records" summary={`${rows.length} records`}>
      <ul>
        {rows.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] py-1.5 text-[0.8125rem] first:border-t-0">
            <span className="min-w-0 [overflow-wrap:anywhere]">{row.label}</span>
            <Link href={row.href} className="min-h-8 shrink-0 content-center text-[hsl(var(--e-primary))] underline max-sm:min-h-11">Open<span className="sr-only"> {row.label}</span></Link>
          </li>
        ))}
      </ul>
    </FoldSection>
  );
}

export function HistoryCard({ context, timeZone, zone }: { context: DamageRecordContext; timeZone: string; zone: string }) {
  const latest = context.history[0];
  return (
    <FoldSection
      id="d-history"
      title="History"
      summary={`${context.history.length} event${context.history.length === 1 ? "" : "s"}${latest ? ` · last ${dayTime(latest.at, timeZone)}` : ""}`}
      action={<span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{zone}</span>}
    >
      {context.history.length === 0 ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Nothing recorded yet.</p>
      ) : (
        <ol className="text-[0.8125rem]">
          {context.history.map((entry) => (
            <li key={entry.id} className="grid grid-cols-1 gap-x-3 border-t border-[hsl(var(--e-border))] py-2 first:border-t-0 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
              <span className="whitespace-nowrap text-[hsl(var(--e-text-secondary))]">{dayTime(entry.at, timeZone) ?? "Time not recorded"}</span>
              <span className="min-w-0 [overflow-wrap:anywhere]"><b className="font-[600]">{entry.lead}</b> {entry.detail}</span>
            </li>
          ))}
        </ol>
      )}
    </FoldSection>
  );
}

export function UnavailableCard({ message }: { message: string }) {
  return (
    <ECard className="p-4">
      <p role="alert" className="text-[0.875rem]">{message}</p>
    </ECard>
  );
}
