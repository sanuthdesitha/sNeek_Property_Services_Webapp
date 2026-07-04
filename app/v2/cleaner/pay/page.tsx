import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getCleanerInvoiceData, type CleanerInvoiceData } from "@/lib/cleaner/invoice";
import {
  EBadge,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EPageHeader,
  EStatCard,
  EEmptyState,
} from "@/components/v2/ui/primitives";

export const metadata = { title: "Pay · Estate cleaner" };
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

export default async function CleanerPayPage() {
  const session = await requireRole([Role.CLEANER]);

  // Current-period cleaner invoice summary — the same source the live cleaner
  // invoice page uses, scoped to the session user. Defaults to month-to-date.
  const data: CleanerInvoiceData | null = await getCleanerInvoiceData({
    userId: session.user.id,
  }).catch(() => null);

  if (!data) {
    return (
      <div className="space-y-6">
        <EPageHeader eyebrow="Earnings" title="Pay" description="Your current period at a glance." />
        <EEmptyState
          eyebrow="Unavailable"
          title="Pay summary not available"
          description="We couldn't load your invoice data right now. Try again shortly."
        />
      </div>
    );
  }

  const periodLine = `${shortDate(data.start)} – ${shortDate(data.end)}`;
  const jobRows = data.rows.slice(0, 8);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Earnings"
        title="Pay"
        description={`Current period · ${periodLine}`}
      />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <EStatCard label="Estimated pay" value={money(data.estimatedPay)} delta={`${data.rows.length} job${data.rows.length === 1 ? "" : "s"}`} deltaTone="neutral" />
        <EStatCard label="Paid hours" value={data.hours.toFixed(1)} delta="this period" deltaTone="neutral" />
        <EStatCard
          label="Pending"
          value={money(data.pendingAdjustmentAmount)}
          delta={
            data.pendingAdjustmentCount > 0
              ? `${data.pendingAdjustmentCount} request${data.pendingAdjustmentCount === 1 ? "" : "s"}`
              : "none"
          }
          deltaTone="neutral"
        />
      </section>

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
                    <p className="truncate text-[0.875rem] font-medium">{r.property}</p>
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

      {data.expenseTotal > 0 || data.shoppingTimeTotal > 0 ? (
        <ECard>
          <ECardHeader>
            <ECardTitle>Reimbursements</ECardTitle>
          </ECardHeader>
          <ECardBody className="pt-0">
            <div className="divide-y divide-[hsl(var(--e-border))]">
              {data.expenseTotal > 0 ? (
                <div className="flex items-center justify-between gap-3 py-3 first:pt-0">
                  <p className="text-[0.875rem] font-medium">Shopping reimbursements</p>
                  <div className="flex items-center gap-3">
                    <span className="e-numeral text-[0.9375rem]">{money(data.expenseTotal)}</span>
                    <EBadge tone="info" soft>{data.expenseRows.length}</EBadge>
                  </div>
                </div>
              ) : null}
              {data.shoppingTimeTotal > 0 ? (
                <div className="flex items-center justify-between gap-3 py-3 first:pt-0">
                  <p className="text-[0.875rem] font-medium">Shopping time</p>
                  <span className="e-numeral text-[0.9375rem]">{money(data.shoppingTimeTotal)}</span>
                </div>
              ) : null}
            </div>
          </ECardBody>
        </ECard>
      ) : null}
    </div>
  );
}
