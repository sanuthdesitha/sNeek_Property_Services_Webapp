import Link from "next/link";
import { Role, PayAdjustmentStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getQaPaySummary } from "@/lib/qa/pay";
import { buildQaPayHeadline, lineNeedsOffice, OFFICE_TO_FIX, qaPayLineAmount, qaPayMoney } from "@/lib/qa/pay-view";
import { SegmentTabs } from "@/components/v2/cleaner/portal/segment-tabs";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EPageHeader,
} from "@/components/v2/ui/primitives";

export const metadata = { title: "Pay · Estate QA" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

type PayTab = "reviews" | "credits" | "invoices";

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
  searchParams?: { from?: string; to?: string; tab?: string };
}) {
  const session = await requireRole([Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN]);

  const summary = await getQaPaySummary({
    inspectorId: session.user.id,
    startDate: searchParams?.from,
    endDate: searchParams?.to,
  }).catch((err) => {
    // This used to swallow every failure into the bland "not available" empty
    // state with no trace anywhere — so a broken query looked identical to a
    // quiet month, and the inspector simply concluded their pay had vanished.
    console.error("[qa/pay] getQaPaySummary failed", {
      inspectorId: session.user.id,
      from: searchParams?.from ?? null,
      to: searchParams?.to ?? null,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });

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

  const headline = buildQaPayHeadline(summary);
  const periodLine = `${shortDate(summary.start)} – ${shortDate(summary.end)}`;
  const tab: PayTab = searchParams?.tab === "credits" || searchParams?.tab === "invoices" ? searchParams.tab : "reviews";
  const keep = new URLSearchParams();
  if (searchParams?.from) keep.set("from", searchParams.from);
  if (searchParams?.to) keep.set("to", searchParams.to);
  const tabHref = (key: PayTab) => {
    const qs = new URLSearchParams(keep);
    if (key !== "reviews") qs.set("tab", key);
    const text = qs.toString();
    return `/v2/qa/pay${text ? `?${text}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <EPageHeader eyebrow="Earnings" title="Pay" description={periodLine} />

      {/* Board: one headline for the period, then what it is made of. A job
          with no rate says "Office to fix" and the total says it is not final. */}
      <ECard>
        <ECardBody className="space-y-3 pt-5">
          <div className="flex items-end justify-between gap-3">
            <p className="e-numeral text-[2rem] leading-none">{headline.total}</p>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{headline.inspectionsLabel}</p>
          </div>
          {headline.incompleteNote ? (
            <p className="text-[0.8125rem] font-[550] text-[hsl(var(--e-warning))]">{headline.incompleteNote}</p>
          ) : null}
          <dl className="divide-y divide-[hsl(var(--e-border))] text-[0.8125rem]">
            {headline.breakdown.map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-3 py-2">
                <dt className="min-w-0 text-[hsl(var(--e-text-secondary))]">{row.label}</dt>
                <dd className={row.tone === "warning" ? "shrink-0 font-[600] text-[hsl(var(--e-warning))]" : "e-tnum shrink-0 font-[550]"}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            {qaPayMoney(summary.totals.settled)} settled · {qaPayMoney(summary.totals.unsettled)} awaiting payment
          </p>
        </ECardBody>
      </ECard>

      <SegmentTabs
        label="Pay sections"
        activeKey={tab}
        tabs={[
          { key: "reviews", label: "Reviews", href: tabHref("reviews"), count: summary.inspections.length },
          { key: "credits", label: "Credits", href: tabHref("credits"), count: summary.adjustments.length },
          { key: "invoices", label: "Invoices", href: tabHref("invoices") },
        ]}
      />

      {tab === "reviews" ? (
      <ECard>
        <ECardHeader className="flex flex-row items-center justify-between gap-2">
          <ECardTitle>Inspections this period</ECardTitle>
          <Link href="/v2/qa/reviews" className="text-[0.8125rem] font-[550] text-[hsl(var(--e-accent-portal))] underline-offset-2 hover:underline">
            All reviews
          </Link>
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
                    {/* Never $0.00 for a missing rate: the office has to set it. */}
                    <span className={lineNeedsOffice(line) ? "text-[0.8125rem] font-[600] text-[hsl(var(--e-warning))]" : "e-numeral text-[0.9375rem]"}>
                      {qaPayLineAmount(line)}
                    </span>
                    <div className="mt-1">
                      {lineNeedsOffice(line) ? (
                        <EBadge tone="warning">Rate not set</EBadge>
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

      ) : null}

      {tab === "credits" ? (
        summary.adjustments.length === 0 ? (
          <EEmptyState
            eyebrow="Nothing yet"
            title="No credits or adjustments"
            description="Self-rework claims and approved adjustments for this period appear here."
          />
        ) : (
        <ECard>
          <ECardHeader>
            <ECardTitle>Credits &amp; adjustments</ECardTitle>
          </ECardHeader>
          <ECardBody className="pt-0">
            <div className="divide-y divide-[hsl(var(--e-border))]">
              {summary.adjustments.map((row) => (
                <div key={row.id} className="flex items-start justify-between gap-3 py-3 first:pt-0">
                  <div className="min-w-0">
                    {/* Universal edit-or-navigate rule: an inspector cannot edit
                        their own pay, so each adjustment links to the job whose
                        pay card is the ONE editable source. */}
                    <p className="truncate text-[0.875rem] font-medium">
                      {row.jobId ? (
                        <Link href={`/v2/qa/jobs/${row.jobId}`} className="hover:underline">
                          {row.title}
                        </Link>
                      ) : (
                        row.title
                      )}
                    </p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {row.property ? `${row.property} · ` : ""}
                      {row.reviewedAt ? shortDate(row.reviewedAt) : "awaiting review"}
                    </p>
                    {/* Same origin wording as the admin job pay card + invoice. */}
                    <p className="mt-0.5 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                      {row.originLabel}
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
        )
      ) : null}

      {tab === "invoices" ? (
        // Anything still "Pending" is money the inspector bills themselves —
        // this rail (not an admin pay run) is how most of it gets paid.
        <ECard>
          <ECardBody className="space-y-3 pt-5">
            <p className="text-[0.875rem] font-[600]">Invoice this work</p>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Raise your own invoice for completed inspections and approved adjustments, then download it or email it to accounts.
              Inspections marked &ldquo;{OFFICE_TO_FIX}&rdquo; are left out until the office sets their rate.
            </p>
            <EButton asChild variant="gold" size="lg" className="w-full sm:w-auto">
              <Link href="/v2/qa/invoices">Invoice this work</Link>
            </EButton>
          </ECardBody>
        </ECard>
      ) : (
        <EButton asChild variant="outline" size="lg" className="w-full">
          <Link href="/v2/qa/invoices">Invoice this work</Link>
        </EButton>
      )}
    </div>
  );
}
