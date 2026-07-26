import Link from "next/link";
import { Role, PayAdjustmentStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getQaPaySummary } from "@/lib/qa/pay";
import {
  EBadge,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EPageHeader,
  EStatCard,
} from "@/components/v2/ui/primitives";

export const metadata = { title: "Pay · Estate QA" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return (
    sign +
    "$" +
    Math.abs(Number.isFinite(n) ? n : 0).toLocaleString("en-AU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function shortDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-AU", { timeZone: TZ, day: "numeric", month: "short" });
}

/** Plain-English explanation of how a line was priced — the inspector should never
 *  have to ask an admin why a number is what it is. */
function basisLabel(line: { mode: string; basis: string; hours: number; rate: number }): string {
  if (line.mode === "NONE") return "Unpaid inspection";
  if (line.mode === "FIXED") return "Fixed rate";
  const hoursSource =
    line.basis === "ALLOCATED"
      ? "allocated"
      : line.basis === "ACTUAL"
      ? "on site"
      : "standard";
  return `${line.hours.toFixed(2)}h ${hoursSource} × ${money(line.rate)}/hr`;
}

export default async function QaPayPage({
  searchParams,
}: {
  searchParams?: { from?: string; to?: string };
}) {
  const session = await requireRole([Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN]);

  const summary = await getQaPaySummary({
    inspectorId: session.user.id,
    startDate: searchParams?.from,
    endDate: searchParams?.to,
  }).catch(() => null);

  if (!summary) {
    return (
      <div className="space-y-6">
        <EPageHeader eyebrow="Earnings" title="Pay" description="Your inspections and credits." />
        <EEmptyState
          eyebrow="Unavailable"
          title="Pay summary not available"
          description="We couldn't load your pay data right now. Try again shortly."
        />
      </div>
    );
  }

  const { totals } = summary;
  const periodLine = `${shortDate(summary.start)} – ${shortDate(summary.end)}`;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Earnings"
        title="Pay"
        description={`Current period · ${periodLine}`}
      />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <EStatCard
          label="Total earned"
          value={money(totals.total)}
          delta="inspections + credits"
          deltaTone="neutral"
        />
        <EStatCard
          label="Inspections"
          value={money(totals.inspectionPay)}
          delta={`${totals.inspectionCount} completed`}
          deltaTone="neutral"
        />
        <EStatCard
          label="Adjustments"
          value={money(totals.approvedAdjustments)}
          delta={
            totals.pendingAdjustments > 0
              ? `${money(totals.pendingAdjustments)} pending`
              : "approved"
          }
          deltaTone="neutral"
        />
        <EStatCard
          label="Awaiting payment"
          value={money(totals.unsettled)}
          delta={`${money(totals.settled)} settled`}
          deltaTone="neutral"
        />
      </section>

      <ECard>
        <ECardHeader>
          <ECardTitle>Inspections this period</ECardTitle>
        </ECardHeader>
        <ECardBody className="pt-0">
          {summary.inspections.length === 0 ? (
            <EEmptyState
              eyebrow="Nothing yet"
              title="No completed inspections"
              description="Inspections you complete in this period will appear here with their pay."
            />
          ) : (
            <div className="divide-y divide-[hsl(var(--e-border))]">
              {summary.inspections.map((line) => (
                <div key={line.id} className="flex items-start justify-between gap-3 py-3 first:pt-0">
                  <div className="min-w-0">
                    <p className="truncate text-[0.875rem] font-medium">
                      {line.jobId ? (
                        <Link href={`/v2/qa/jobs/${line.jobId}`} className="hover:underline">
                          {line.property}
                        </Link>
                      ) : (
                        line.property
                      )}
                    </p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {shortDate(line.completedAt)}
                      {line.suburb ? ` · ${line.suburb}` : ""} · {basisLabel(line)}
                    </p>
                    {line.note ? (
                      <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-faint))]">{line.note}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="e-numeral text-[0.9375rem]">{money(line.amount)}</span>
                    <div className="mt-1">
                      {line.rateMissing ? (
                        <EBadge tone="danger">Rate not set</EBadge>
                      ) : (
                        // Both rails can settle an inspection, so say WHICH one:
                        // "Paid" alone left an inspector unable to tell whether
                        // to look for the money on a payslip or on their invoice.
                        <EBadge tone={line.settlement === "PAID" ? "success" : "neutral"}>
                          {line.settlement === "PAID"
                            ? line.settledVia === "CLEANER_INVOICE"
                              ? "Paid · invoice"
                              : "Paid · pay run"
                            : "Pending"}
                        </EBadge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ECardBody>
      </ECard>

      {summary.adjustments.length > 0 ? (
        <ECard>
          <ECardHeader>
            <ECardTitle>Credits &amp; adjustments</ECardTitle>
          </ECardHeader>
          <ECardBody className="pt-0">
            <div className="divide-y divide-[hsl(var(--e-border))]">
              {summary.adjustments.map((row) => (
                <div key={row.id} className="flex items-start justify-between gap-3 py-3 first:pt-0">
                  <div className="min-w-0">
                    <p className="truncate text-[0.875rem] font-medium">{row.title}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {row.property ? `${row.property} · ` : ""}
                      {row.reviewedAt ? shortDate(row.reviewedAt) : "awaiting review"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="e-numeral text-[0.9375rem]">
                      {money(
                        row.status === PayAdjustmentStatus.PENDING ? row.requestedAmount : row.amount
                      )}
                    </span>
                    <div className="mt-1">
                      <EBadge
                        tone={
                          row.status === PayAdjustmentStatus.APPROVED
                            ? row.settlement === "PAID"
                              ? "success"
                              : "neutral"
                            : row.status === PayAdjustmentStatus.REJECTED
                            ? "danger"
                            : "neutral"
                        }
                      >
                        {row.status === PayAdjustmentStatus.APPROVED && row.settlement === "PAID"
                          ? row.settledVia === "CLEANER_INVOICE"
                            ? "Paid · invoice"
                            : "Paid · pay run"
                          : row.status.charAt(0) + row.status.slice(1).toLowerCase()}
                      </EBadge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ECardBody>
        </ECard>
      ) : null}
    </div>
  );
}
