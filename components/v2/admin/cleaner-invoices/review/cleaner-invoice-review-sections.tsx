"use client";

/**
 * Read-only sections of the cleaner invoice review page (board "Cleaner
 * invoice", 2026-11-17): the pay-rule band, the lines as submitted with rate
 * snapshots, the status notice, the submitted-against-expected comparison, the
 * Xero card and the history. Every amount is the stored one; a missing figure
 * is written in words, never shown as zero.
 */
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { EToneCard, EToneNotice } from "@/components/v2/ui/tone-band";
import { EvidenceThumbs } from "@/components/v2/shared/evidence-thumbs";
import { PayRequestDetails } from "@/components/v2/shared/pay-request-details";
import type { CleanerInvoiceReview } from "@/lib/cleaner/invoice-review";
import { SubmissionBlock } from "../expected-invoice-cards";
import { CLEANER_PAY_METHOD_LABEL, fmtDay, type CleanerRow } from "../cleaner-invoice-model";
import { aud, audOr, plural, stamp } from "../../pay-records/format";
import { HistoryList, MUTED, RailCard, SMALL } from "../../pay-records/record-parts";

const FIRST_LINES = 8;

function firstName(row: CleanerRow): string {
  return row.cleanerName.split(" ")[0] || row.cleanerName;
}

/** The owner's pay rule (2026-11-13), written whenever the invoice holds a pay request. */
export function PayRuleBand({ review }: { review: CleanerInvoiceReview }) {
  const { payRequests, row } = review;
  if ("error" in payRequests) {
    return <p role="alert" className={cn(SMALL, "text-[hsl(var(--e-danger))]")}>The pay requests on this invoice could not be read: {payRequests.error}</p>;
  }
  if (!payRequests.length) return null;
  const name = firstName(row);
  return (
    <EToneCard
      tone="info"
      aria-label="Pay rule"
      header={
        <div>
          <b>{name} is paid what they asked for</b>
          <p className="text-[0.75rem] opacity-90">Owner rule, 13 Nov: when a pay request was sent to the client at a different rate, the client&apos;s amount never changes the payee&apos;s pay.</p>
        </div>
      }
      pill={plural(payRequests.length, "pay request")}
    >
      <ul className="space-y-1">
        {payRequests.map((request) => (
          <li key={request.id} className={SMALL}>
            {request.jobNumber ? `${request.jobNumber} ` : ""}{request.title}:{" "}
            <b>{name} asked {audOr(request.requestedAmount, "an amount that is not stored")}, paid {audOr(request.paidAmount, "an amount that is not stored")}.</b>
            {request.clientCharge ? (
              <span className={MUTED}> {request.clientCharge.label}, read only, billed on the client&apos;s invoice and not paid to {name}.</span>
            ) : null}
            {/* What it was for, the job, the decision and its history (2026-11-18). */}
            <PayRequestDetails key={request.id} requestId={request.id} />
          </li>
        ))}
      </ul>
    </EToneCard>
  );
}

export function LinesCard({ review }: { review: CleanerInvoiceReview }) {
  const { lines, row } = review;
  const [showAll, setShowAll] = React.useState(false);
  if ("error" in lines) {
    return (
      <section aria-label="Lines as submitted" className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3.5">
        <h2 className="text-[0.9375rem] font-[600]">Lines as submitted</h2>
        <p role="alert" className={cn(SMALL, "text-[hsl(var(--e-danger))]")}>The lines could not be read: {lines.error}. Total (stored) {aud(row.totalAmount)}.</p>
      </section>
    );
  }
  const visible = showAll ? lines : lines.slice(0, FIRST_LINES);
  return (
    <section aria-labelledby="ci-lines" className="min-w-0 overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-2 pt-3.5">
        <h2 id="ci-lines" className="text-[0.9375rem] font-[600]">{row.amendmentCount ? "Lines as amended" : "Lines as submitted"}</h2>
        <p className={cn("text-[0.75rem]", MUTED)}>{row.amendmentCount ? `Amended by the office; ${firstName(row)}'s original lines are kept in the amendment history.` : `The snapshot ${firstName(row)} sent.`} Change lines with Amend this invoice, or send it back with Request changes.</p>
      </div>
      {lines.length ? (
        <>
          <div className="overflow-x-auto max-sm:hidden" role="region" aria-label="Invoice lines" tabIndex={0}>
            <table className="w-full min-w-[30rem] text-[0.875rem]">
              <thead className="bg-[hsl(var(--e-surface-raised))] text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-[500]">Line</th>
                  <th scope="col" className="px-3 py-2 text-right font-[500]">Hours</th>
                  <th scope="col" className="px-3 py-2 text-right font-[500]">Rate snapshot</th>
                  <th scope="col" className="px-3 py-2 text-right font-[500]">Amount</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((line) => (
                  <tr key={line.index} className="border-t border-[hsl(var(--e-border))]">
                    <td className="px-3 py-2">
                      {line.jobId ? <Link href={`/v2/admin/jobs/${line.jobId}`} className="underline underline-offset-2">{line.jobNumber ?? "Job"}</Link> : null}
                      {line.jobId ? " · " : null}
                      {line.description}
                    </td>
                    <td className={cn("e-tnum px-3 py-2 text-right", line.hours === null && MUTED)}>{line.hours === null ? "–" : line.hours.toFixed(2)}</td>
                    <td className={cn("e-tnum px-3 py-2 text-right", line.rateSnapshot === null && MUTED)}>{line.rateSnapshot === null ? "–" : `${aud(line.rateSnapshot)}/h`}</td>
                    <td className={cn("e-tnum px-3 py-2 text-right", line.amount === null && MUTED)}>{line.amount === null ? "–" : aud(line.amount)}</td>
                  </tr>
                ))}
                {lines.length > FIRST_LINES ? (
                  <tr className="border-t border-[hsl(var(--e-border))]">
                    <td colSpan={4} className={cn("px-3 py-2", SMALL, MUTED)}>
                      <button type="button" className="underline underline-offset-2" onClick={() => setShowAll((value) => !value)}>
                        {showAll ? "Show fewer lines" : `${lines.length - FIRST_LINES} more lines · Show all ${lines.length}`}
                      </button>
                    </td>
                  </tr>
                ) : null}
                <tr className="border-t-2 border-[hsl(var(--e-border-strong))]">
                  <td colSpan={3} className="px-3 py-2 font-[600]">Total (stored) <span className={cn("font-normal", SMALL, MUTED)}>· as stored on the submission</span></td>
                  <td className="e-tnum px-3 py-2 text-right font-[600]">{aud(row.totalAmount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-[hsl(var(--e-border))] border-t border-[hsl(var(--e-border))] px-4 sm:hidden" aria-label="Invoice lines">
            {visible.map((line) => (
              <li key={line.index} className={cn("flex justify-between gap-3 py-2", SMALL)}>
                <span className="min-w-0 break-words">{line.jobNumber ? `${line.jobNumber} ` : ""}{line.description}{line.hours !== null ? ` · ${line.hours.toFixed(2)} h` : ""}</span>
                <b className="e-tnum shrink-0">{line.amount === null ? "–" : aud(line.amount)}</b>
              </li>
            ))}
            {lines.length > FIRST_LINES ? (
              <li className={cn("flex justify-between py-2", SMALL)}>
                <span className={MUTED}>{showAll ? "All lines shown" : `${lines.length - FIRST_LINES} more lines`}</span>
                <button type="button" className="underline underline-offset-2" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show fewer" : "Show all"}</button>
              </li>
            ) : null}
            <li className={cn("flex justify-between py-2 font-[600]", SMALL)}><span>Total (stored)</span><span className="e-tnum">{aud(row.totalAmount)}</span></li>
          </ul>
        </>
      ) : (
        <p className={cn("px-4 pb-3", SMALL, MUTED)}>No line snapshot stored for this submission. Total (stored) {aud(row.totalAmount)}.</p>
      )}
      <p className={cn("border-t border-[hsl(var(--e-border))] px-4 py-2 text-[0.75rem]", MUTED)}>
        A line with no hours or rate says &quot;–&quot;, never 0. Rates are the assignment snapshots; a rate change made later never alters a submitted invoice.
      </p>
    </section>
  );
}

/** What the status means now, in a tone band (no left line). */
export function StatusNotice({ review }: { review: CleanerInvoiceReview }) {
  const { row } = review;
  const name = firstName(row);
  switch (row.status) {
    case "XERO_EXPORTING":
      return <EToneNotice tone="attention" title="Xero export pending">The push did not finish. Nothing is paid. Retry, or record a payment if you paid outside Xero.</EToneNotice>;
    case "SENDING":
      return <EToneNotice tone="problem" title="Delivery review: send interrupted">Money reserved. Review delivery: confirmed received (keep) or not delivered (reverse and release), each with the evidence written.</EToneNotice>;
    case "CHANGES_REQUESTED":
      return (
        <EToneNotice tone="attention" title={`Sent back for changes ${row.changesRequestedAt ? `· ${stamp(row.changesRequestedAt, review.timezone)}` : ""}`}>
          <p className="whitespace-pre-wrap">{row.changesRequestedNote || "No reason recorded."}</p>
          <p className="mt-1">Everything on it was released, so {name} can rebuild and resend it as a new submission.</p>
        </EToneNotice>
      );
    case "PAID":
      return (
        <EToneNotice tone="good" title="Paid">
          Amount paid {aud(row.paidAmount ?? row.totalAmount)}
          {row.paymentMethod ? ` · ${CLEANER_PAY_METHOD_LABEL[row.paymentMethod] ?? row.paymentMethod}` : ""}
          {row.paidBankAccount ? ` · to ${row.paidBankAccount}` : ""}
          {row.paidDate ? ` · paid ${fmtDay(row.paidDate)}` : ""}
          {review.paymentRecordedBy ? ` · recorded by ${review.paymentRecordedBy}` : ""}. Nothing can change.
          {row.paidNote ? <span className="mt-1 block">Comments: {row.paidNote}</span> : null}
        </EToneNotice>
      );
    default:
      break;
  }
  if (row.paidClaimedAt) {
    return (
      <EToneCard tone="attention" header={<b>Payment claimed {stamp(row.paidClaimedAt, review.timezone)}</b>} pill={`${name} says paid`}>
        {row.paidClaimedNote ? <p className={cn("mb-2", SMALL)}>&ldquo;{row.paidClaimedNote}&rdquo;</p> : null}
        {row.paidClaimedProofUrls.length ? (
          <EvidenceThumbs items={row.paidClaimedProofUrls} alt="Payment proof" docLabel="Open receipt" />
        ) : (
          <p className={cn(SMALL, MUTED)}>No proof attached.</p>
        )}
        {row.status === "PAID_CLAIMED" ? <p className={cn("mt-2 text-[0.75rem]", MUTED)}>Record payment confirms it. Reject payment claim returns it and keeps the claim and proof on record.</p> : null}
      </EToneCard>
    );
  }
  return null;
}

export function ComparisonCard({ review }: { review: CleanerInvoiceReview }) {
  const { comparison, row } = review;
  return (
    <RailCard title="Submitted against expected">
      {comparison.status === "not-applicable" ? <p className={cn(SMALL, MUTED)}>{comparison.reason}</p> : null}
      {comparison.status === "error" ? <p role="alert" className={cn(SMALL, "text-[hsl(var(--e-danger))]")}>The comparison could not be computed: {comparison.message}</p> : null}
      {comparison.status === "ready" ? (
        <>
          <dl className={cn("grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 gap-y-1", SMALL)}>
            <dt className={MUTED}>This invoice</dt>
            <dd><b className="e-tnum">{aud(row.totalAmount)}</b> · {plural(row.jobCount, "job")}</dd>
            <dt className={MUTED}>Forecast now</dt>
            <dd>{comparison.expected ? <><b className="e-tnum">{aud(comparison.expected.expectedTotal)}</b> · {plural(comparison.expected.jobCount, "job")}</> : "Nothing unpaid is forecast"}</dd>
            {comparison.expected?.rateMissingCount ? (
              <>
                <dt className={MUTED}>No rate</dt>
                <dd>{plural(comparison.expected.rateMissingCount, "job")}, so the forecast is understated</dd>
              </>
            ) : null}
          </dl>
          {comparison.expected ? <SubmissionBlock submission={comparison.expected.submission} /> : null}
          <p className={cn("text-[0.75rem]", MUTED)}>The forecast is today&apos;s unpaid work for this payee in the period, not a copy of what was sent. Nothing is added to the invoice automatically; the next invoice picks up anything missing.</p>
        </>
      ) : null}
    </RailCard>
  );
}

function connectionLine(xero: Exclude<CleanerInvoiceReview["xero"], { error: string }>, timezone: string): string {
  const connection = xero.connection;
  if (connection.status === "connected") return `Xero is connected (${connection.tenantName}${connection.lastRefreshedAt ? `, renewed ${stamp(connection.lastRefreshedAt, timezone)}` : ""}).`;
  if (connection.status === "attention") return `Xero needs attention: ${connection.reason ?? "check Settings, Xero"}.`;
  if (connection.status === "not-connected") return "Xero is not connected, so a push would fail until it is connected in Settings.";
  return `The Xero connection could not be read: ${connection.message}`;
}

export function XeroCard({ review }: { review: CleanerInvoiceReview }) {
  const { xero, row } = review;
  return (
    <RailCard title="Xero">
      {"error" in xero ? (
        <p role="alert" className={cn(SMALL, "text-[hsl(var(--e-danger))]")}>The Xero state could not be read: {xero.error}</p>
      ) : (
        <>
          {xero.state === "pushed" ? (
            <p className={SMALL}><b>In Xero</b> as draft bill {xero.billId?.slice(0, 8)}…{xero.exportedAt ? `, pushed ${stamp(xero.exportedAt, review.timezone)}` : ""}. It can be paid but not reversed or deleted here; void it in Xero first.</p>
          ) : xero.state === "pending" ? (
            <EToneNotice tone="attention" title="The push did not finish">
              Its money stays reserved. {xero.lastFailure ? `Last attempt ${stamp(xero.lastFailure.at, review.timezone)}: ${xero.lastFailure.reason}` : "No reason was recorded."} Retry push, or record a payment if it was paid outside Xero.
            </EToneNotice>
          ) : (
            <p className={SMALL}><b>Not in Xero.</b> {row.status === "SUBMITTED" ? `After approval, "Push to Xero" creates a draft bill for ${firstName(row)}.` : row.status === "APPROVED" ? `"Push to Xero" creates a draft bill for ${firstName(row)}.` : "Nothing is sent to Xero from this state."}</p>
          )}
          <BillAccounts xero={xero} />
          <p className={cn("text-[0.75rem]", MUTED)}>{connectionLine(xero, review.timezone)}</p>
        </>
      )}
    </RailCard>
  );
}

/** The Xero accounts the bill's lines go to, or why a push would be refused (2026-11-23). */
function BillAccounts({ xero }: { xero: Exclude<CleanerInvoiceReview["xero"], { error: string }> }) {
  const accounts = xero.accounts;
  if (!accounts || xero.state === "pushed") return null;
  if (accounts.status === "error") return <p role="alert" className={cn(SMALL, "text-[hsl(var(--e-danger))]")}>The Xero accounts could not be read: {accounts.message}</p>;
  if (accounts.status === "not-set") {
    return (
      <EToneNotice tone="problem" title="No Xero account chosen for cleaner invoices">
        Push to Xero is refused until an administrator chooses the cleaning work account in <Link href="/v2/admin/settings?tab=xero" className="underline underline-offset-2">Settings › Money › Xero</Link>. Nothing is sent to a default account.
      </EToneNotice>
    );
  }
  return (
    <div className={SMALL}>
      <p className="font-[550]">Xero accounts for this bill</p>
      <ul className="mt-1 space-y-0.5">
        {accounts.groups.map((group) => (
          <li key={`${group.label}:${group.code}`}>
            {group.label}: <span className="e-tnum">{group.code}</span>
            {group.name ? ` · ${group.name}` : <span className={MUTED}> · name not read{group.nameReason ? ` (${group.nameReason})` : ""}</span>}
            {group.lines ? <span className={MUTED}> · {plural(group.lines, "line")}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HistoryCard({ review }: { review: CleanerInvoiceReview }) {
  return (
    <RailCard title="History">
      <HistoryList entries={review.history} timezone={review.timezone} />
      <p className={cn("text-[0.75rem]", MUTED)}>Times in {review.timezone.replace(/_/g, " ")}. Up to 50 entries from the audit log.</p>
    </RailCard>
  );
}
