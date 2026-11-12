/**
 * The job page header (server component): breadcrumb, the page's one h1 with
 * the status badge, the sub line, the actions, the eight-step stage bar, the
 * key facts row, and what the page leads with for this status (the lead
 * block, then any blockers linking into their stage).
 */
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { EBadge } from "@/components/v2/ui/primitives";
import { EStageBar } from "@/components/v2/ui/stage-bar";
import { blockersHeading } from "@/lib/jobs/job-page/blockers";
import type { JobPageOpen } from "@/lib/jobs/job-page/deep-link";
import { formatMinutes, siteMinutes, type JobFact } from "@/lib/jobs/job-page/facts";
import { JobHeaderActions } from "./job-header-actions";
import { titleCase, type JobPageData } from "./job-page-data";
import { CancelledLead } from "./job-restore";
import { JobSuggestions } from "./job-suggestions";

function FactCard({ fact }: { fact: JobFact }) {
  return (
    <div className="min-w-0 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2.5 py-2 text-[0.8125rem]">
      <p className="mb-0.5 font-[500] text-[hsl(var(--e-muted-foreground))]">{fact.label}</p>
      <p className="min-w-0 [overflow-wrap:anywhere]">
        <b className={fact.unknown ? "font-[500] text-[hsl(var(--e-muted-foreground))]" : "text-[0.875rem] tabular-nums"}>{fact.value}</b>{" "}
        {fact.note ? <span className="text-[hsl(var(--e-muted-foreground))]">{fact.note}</span> : null}{" "}
        {fact.badge ? <EBadge tone={fact.badge.tone} soft>{fact.badge.text}</EBadge> : null}
      </p>
    </div>
  );
}

function UnassignedLead({ data }: { data: JobPageData }) {
  const { job } = data;
  const arriving = data.model.facts.find((fact) => fact.key === "guest-in");
  return (
    <section aria-label="Needs a cleaner" className="space-y-2 rounded-[var(--e-radius-lg)] bg-[hsl(var(--e-danger-soft))] px-4 py-3 text-[0.8125rem]">
      <p className="font-[600]">
        Needs a cleaner{job.startTime ? ` by ${job.startTime}` : ""}.
        {arriving && !arriving.unknown ? ` Next guest arrives ${arriving.value}.` : ""}
      </p>
      <JobSuggestions jobId={job.id} readOnly={data.viewer.readOnly} />
    </section>
  );
}

function InProgressLead({ data, now }: { data: JobPageData; now: Date }) {
  const { job, model } = data;
  const open = model.openLog;
  const site = siteMinutes(job.timeLogs, now);
  const allocated = job.estimatedHours != null ? job.estimatedHours * 60 : null;
  const fraction = site && allocated ? Math.min(1, site.minutes / allocated) : null;
  const checklist = model.facts.find((fact) => fact.key === "checklist");
  return (
    <section aria-label="Work in progress" className="space-y-2 rounded-[var(--e-radius-lg)] bg-[hsl(var(--e-info-soft))] px-4 py-3 text-[0.8125rem]">
      <div className="flex flex-wrap items-center gap-2">
        {open ? <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[hsl(var(--e-success))] shadow-[0_0_0_3px_hsl(var(--e-success-soft))]" /> : null}
        <b>
          {open
            ? `${open.user?.name ?? open.user?.email ?? "Cleaner"} clocked in ${formatInTimeZone(open.startedAt, data.timeZone, "HH:mm")}, running ${formatMinutes((now.getTime() - open.startedAt.getTime()) / 60_000)}`
            : `${model.statusLabel}: no clock running`}
        </b>
        <span className="grow" />
        <span className="text-[hsl(var(--e-muted-foreground))]">{job.estimatedHours != null ? `of ${job.estimatedHours} h allocated` : "no allocated hours"}</span>
      </div>
      {fraction !== null ? (
        <div role="meter" aria-label="Time on site against allocated hours" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--e-surface-raised))]">
          <i className="block h-full bg-[hsl(var(--e-primary))]" style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{checklist && !checklist.unknown ? `Checklist ${checklist.value}` : "Checklist not submitted yet"}</span>
        <Link href="/v2/admin/ops" className="font-[550] text-[hsl(var(--e-accent-portal))] hover:underline">Open in Live ops</Link>
      </div>
      {data.pendingContinuationCount > 0 ? (
        <p>
          <EBadge tone="warning" soft>{data.pendingContinuationCount} continuation request{data.pendingContinuationCount === 1 ? "" : "s"}</EBadge>{" "}
          <Link href="#s-site" className="text-[hsl(var(--e-accent-portal))] hover:underline">Review request</Link>
        </p>
      ) : null}
    </section>
  );
}

function InvoicedLead({ data }: { data: JobPageData }) {
  const invoice = data.model.liveInvoice;
  if (!invoice) return null;
  const tz = data.timeZone;
  const paid = invoice.paidDate ?? invoice.paidAt ?? null;
  const qa = data.model.qa;
  return (
    <section aria-label="Invoice" className="space-y-1.5 rounded-[var(--e-radius-lg)] bg-[hsl(var(--e-success-soft))] px-4 py-3 text-[0.8125rem]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b>{invoice.invoiceNumber ?? "Invoice"}{invoice.sentAt ? ` · Sent ${formatInTimeZone(invoice.sentAt, tz, "d MMM")}` : " · Not sent yet"}</b>
        <EBadge tone={paid ? "success" : "neutral"}>{paid ? `Paid ${formatInTimeZone(paid, tz, "d MMM yyyy")}` : "Not paid yet"}</EBadge>
      </div>
      <span>
        {invoice.lines.map((line) => line.description).join("; ")} · <span className="tabular-nums">${invoice.lineTotal.toFixed(2)}</span>
        {qa ? ` · QA ${Math.round(qa.score)} ${qa.passed ? "passed" : "failed"}` : " · no QA review"}
        {data.job.report?.sentToClient ? " · report shared" : " · report not shared"}
      </span>
      {data.model.money.chargeState === "locked" ? (
        <p className="text-[hsl(var(--e-muted-foreground))]">The charge is locked on the issued invoice. Corrections go through Reissue or Credit note on the invoice.</p>
      ) : null}
    </section>
  );
}

function Lead({ data, now }: { data: JobPageData; now: Date }) {
  const { job, model } = data;
  const status = model.status;
  if (status === "CANCELLED") {
    const by = job.cancelledBy ? `${job.cancelledBy.name ?? job.cancelledBy.email}${job.cancelledBy.role ? ` (${titleCase(String(job.cancelledBy.role))})` : ""}` : null;
    const when = job.cancelledAt ? formatInTimeZone(job.cancelledAt, data.timeZone, "EEE d MMM HH:mm") : null;
    const line = `Cancelled${when ? ` ${when}` : ""}${by ? ` by ${by}` : ""}`;
    return <CancelledLead cancelledLine={line} reason={job.cancelReason} restoreRefusal={model.restoreRefusal} />;
  }
  if (status === "UNASSIGNED" || status === "OFFERED") return <UnassignedLead data={data} />;
  if (status === "IN_PROGRESS" || status === "PAUSED" || status === "WAITING_CONTINUATION_APPROVAL" || status === "EN_ROUTE") return <InProgressLead data={data} now={now} />;
  if (status === "COMPLETED" || status === "INVOICED") return <InvoicedLead data={data} />;
  return null;
}

export function JobPageHeader({ data, now, initialOpen }: { data: JobPageData; now: Date; initialOpen: JobPageOpen }) {
  const { job, model } = data;
  const submittedBy = job.formSubmissions[0]?.submittedBy;
  const subParts = [
    titleCase(String(job.jobType)),
    data.scheduledLabel,
    data.timeLabel,
    job.property?.client?.name ?? null,
    model.status === "SUBMITTED" && job.formSubmissions[0]
      ? `submitted by ${submittedBy?.name ?? submittedBy?.email ?? "the cleaner"} at ${formatInTimeZone(job.formSubmissions[0].createdAt, data.timeZone, "HH:mm")}`
      : null,
  ].filter(Boolean);
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.8125rem]">
            <Link href="/v2/admin/jobs" className="text-[hsl(var(--e-accent-portal))] hover:underline">← Jobs</Link>{" "}
            <span className="text-[hsl(var(--e-muted-foreground))]">· {job.jobNumber}</span>
          </p>
          <h1 className="e-display-md mt-1 break-words">
            {data.propLabel}{" "}
            <EBadge tone={model.badge.tone} soft className="align-middle">{model.badge.label}</EBadge>{" "}
            {model.meta.isDraft ? <EBadge tone="neutral" soft className="align-middle">Draft</EBadge> : null}{" "}
            {model.skipStatus === "REQUESTED" ? <EBadge tone="warning" soft className="align-middle">Skip requested</EBadge> : null}
            {model.skipStatus === "SKIPPED" ? <EBadge tone="danger" soft className="align-middle">Skipped</EBadge> : null}
          </h1>
          <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{subParts.join(" · ")}</p>
        </div>
        <JobHeaderActions
          jobId={job.id}
          jobLabel={`${data.propLabel} · ${data.scheduledLabel}`}
          statusLabel={model.statusLabel}
          status={model.status}
          primary={model.primary}
          secondary={model.secondary}
          menu={model.menu}
          menuFootnote={model.menuFootnote}
          initialOpen={initialOpen}
          manageJob={data.manageJob}
          hasQaReview={model.qa !== null}
        />
      </header>
      <div className="e-signature-rule" />
      <EStageBar label="Job progress" stages={model.stages} className="max-sm:[&>li]:text-[0.625rem]" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {model.facts.map((fact) => <FactCard key={fact.key} fact={fact} />)}
      </div>
      <Lead data={data} now={now} />
      {model.blockers.length > 0 ? (
        <section aria-label="Needs attention" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-warning)/0.4)] bg-[hsl(var(--e-warning-soft))] px-4 py-3 text-[0.8125rem]">
          <b>{blockersHeading(model.status, model.blockers.length)}</b>
          {model.blockers.map((blocker, index) => (
            <span key={blocker.key} className="inline-flex items-center gap-2">
              {index > 0 ? <span aria-hidden className="text-[hsl(var(--e-muted-foreground))]">·</span> : null}
              <a href={blocker.href} className="text-[hsl(var(--e-accent-portal))] hover:underline">{blocker.text}</a>
            </span>
          ))}
        </section>
      ) : null}
    </div>
  );
}
