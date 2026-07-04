import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getCleanerInvoiceData, type CleanerInvoiceData } from "@/lib/cleaner/invoice";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EPageHeader,
  EStatCard,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { CleanerInvoiceActions } from "@/components/v2/cleaner/invoice-actions";

export const metadata = { title: "Invoices · Estate cleaner" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

function money(n: number): string {
  return "$" + (Number.isFinite(n) ? n : 0).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function shortDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-AU", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
  });
}

export default async function CleanerInvoicesPage() {
  const session = await requireRole([Role.CLEANER]);

  // Current-period invoice summary — the SAME data source the live cleaner
  // invoice screen and the Estate Pay page use, scoped to the session user
  // (defaults to month-to-date). No new API surface.
  const data: CleanerInvoiceData | null = await getCleanerInvoiceData({
    userId: session.user.id,
  }).catch(() => null);

  if (!data) {
    return (
      <div className="space-y-6">
        <EPageHeader
          eyebrow="Earnings"
          title="Invoices"
          description="Review your period, then download or email your invoice."
          actions={
            <Link href="/cleaner/invoices">
              <EButton variant="outline" size="sm">Full invoice tool</EButton>
            </Link>
          }
        />
        <EEmptyState
          eyebrow="Unavailable"
          title="Invoice data not available"
          description="We couldn't load your invoice data right now. Open the full invoice tool to try again."
        />
      </div>
    );
  }

  const periodLine = `${shortDate(data.start)} – ${shortDate(data.end)}`;
  const jobRows = data.rows.slice(0, 10);
  const pendingCount = data.pendingAdjustmentCount ?? 0;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Earnings"
        title="Invoices"
        description={`Current period · ${periodLine}`}
        actions={<CleanerInvoiceActions />}
      />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <EStatCard
          label="Total to invoice"
          value={money(data.estimatedPay)}
          delta={`${data.rows.length} job${data.rows.length === 1 ? "" : "s"}`}
          deltaTone="neutral"
        />
        <EStatCard label="Paid hours" value={data.hours.toFixed(1)} delta="this period" deltaTone="neutral" />
        <EStatCard
          label="Pending"
          value={money(data.pendingAdjustmentAmount ?? 0)}
          delta={pendingCount > 0 ? `${pendingCount} request${pendingCount === 1 ? "" : "s"}` : "none"}
          deltaTone="neutral"
        />
      </section>

      {pendingCount > 0 ? (
        <ECard variant="ceremony">
          <ECardBody className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <div className="min-w-0">
              <p className="text-[0.875rem] font-medium">
                {pendingCount} extra payment{pendingCount === 1 ? "" : "s"} ({money(data.pendingAdjustmentAmount ?? 0)}) awaiting approval
              </p>
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                These are not on this invoice yet — review them before sending.
              </p>
            </div>
            <Link href="/v2/cleaner/pay-requests">
              <EButton variant="outline" size="sm">Review pay requests</EButton>
            </Link>
          </ECardBody>
        </ECard>
      ) : null}

      <ECard>
        <ECardHeader>
          <ECardTitle>Jobs this period</ECardTitle>
        </ECardHeader>
        <ECardBody className="pt-0">
          {jobRows.length === 0 ? (
            <EEmptyState
              eyebrow="Nothing yet"
              title="No payable jobs"
              description="Completed and submitted jobs in this period will show here with their pay."
            />
          ) : (
            <div className="divide-y divide-[hsl(var(--e-border))]">
              {jobRows.map((r) => (
                <div key={r.jobId} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                  <div className="min-w-0">
                    <p className="truncate text-[0.875rem] font-medium">{r.jobName}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {r.date} · {r.jobType} · {r.hours.toFixed(1)}h
                    </p>
                  </div>
                  <span className="e-numeral shrink-0 text-[0.9375rem]">{money(r.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </ECardBody>
      </ECard>

      {(data.expenseTotal ?? 0) > 0 || (data.shoppingTimeTotal ?? 0) > 0 ? (
        <ECard>
          <ECardHeader>
            <ECardTitle>Reimbursements</ECardTitle>
          </ECardHeader>
          <ECardBody className="pt-0">
            <div className="divide-y divide-[hsl(var(--e-border))]">
              {(data.expenseTotal ?? 0) > 0 ? (
                <div className="flex items-center justify-between gap-3 py-3 first:pt-0">
                  <p className="text-[0.875rem] font-medium">Shopping reimbursements</p>
                  <div className="flex items-center gap-3">
                    <span className="e-numeral text-[0.9375rem]">{money(data.expenseTotal ?? 0)}</span>
                    <EBadge tone="info" soft>{data.expenseRows.length}</EBadge>
                  </div>
                </div>
              ) : null}
              {(data.shoppingTimeTotal ?? 0) > 0 ? (
                <div className="flex items-center justify-between gap-3 py-3 first:pt-0">
                  <p className="text-[0.875rem] font-medium">Shopping time</p>
                  <span className="e-numeral text-[0.9375rem]">{money(data.shoppingTimeTotal ?? 0)}</span>
                </div>
              ) : null}
            </div>
          </ECardBody>
        </ECard>
      ) : null}

      <ECard>
        <ECardBody className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="min-w-0">
            <p className="text-[0.875rem] font-medium">Need a custom period, overrides or per-job comments?</p>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Open the full invoice tool to choose a date range, exclude items and preview the PDF before emailing.
            </p>
          </div>
          <Link href="/cleaner/invoices">
            <EButton variant="outline" size="sm">Open full invoice tool</EButton>
          </Link>
        </ECardBody>
      </ECard>
    </div>
  );
}
