import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getCleanerInvoiceData, type CleanerInvoiceData } from "@/lib/cleaner/invoice";
import { EEmptyState, EPageHeader } from "@/components/v2/ui/primitives";
import { CleanerInvoiceActions } from "@/components/v2/cleaner/invoice-actions";
import { InvoicesPanel } from "@/components/v2/cleaner/invoices-panel";
import { PayRequestsPanel } from "@/components/v2/cleaner/pay-requests-panel";
import { SegmentTabs } from "@/components/v2/cleaner/portal/segment-tabs";
import { PayPeriod, type PayRateView } from "@/components/v2/cleaner/pay/pay-period";
import { loadPayRequestOptions } from "@/components/v2/cleaner/pay/load-pay-request-options";
import { payJobStatusLabel, payPeriodLines, resolvePayTab, type PayTabKey } from "@/lib/cleaner/pay-view";
import { sydneyTodayKey } from "@/lib/time/sydney-range";

export const metadata = { title: "Pay · Estate cleaner" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";
const INVOICE_PRESETS = ["thisMonth", "lastMonth", "last2Weeks"] as const;
type InvoicePreset = (typeof INVOICE_PRESETS)[number];

const DESCRIPTIONS: Record<PayTabKey, string> = {
  period: "Money already worked out for the current period.",
  invoices: "Choose a period, adjust hours or comments, then download or email your invoice.",
  requests: "Submit job-linked, property, or standalone extra payment requests with evidence.",
};

function shortDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-AU", { timeZone: TZ, day: "numeric", month: "short" });
}

/** The default rate in force today and when it started (read-only, own record). */
async function loadRate(userId: string): Promise<PayRateView | null> {
  try {
    const today = new Date(`${sydneyTodayKey()}T00:00:00.000Z`);
    const [entry, user] = await Promise.all([
      db.userPayRate.findFirst({
        where: { userId, removedAt: null, effectiveFrom: { lte: today } },
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
        select: { hourlyRate: true, effectiveFrom: true },
      }),
      db.user.findUnique({ where: { id: userId }, select: { hourlyRate: true } }),
    ]);
    if (entry) {
      const baseline = entry.effectiveFrom.getUTCFullYear() <= 1970;
      return { rate: entry.hourlyRate, fromLabel: baseline ? null : entry.effectiveFrom.toLocaleDateString("en-AU", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) };
    }
    return user?.hourlyRate != null ? { rate: user.hourlyRate, fromLabel: null } : null;
  } catch {
    return null;
  }
}

async function loadJobStatuses(userId: string, jobIds: string[]): Promise<Map<string, string>> {
  if (jobIds.length === 0) return new Map();
  const jobs = await db.job
    .findMany({ where: { id: { in: jobIds }, assignments: { some: { userId, removedAt: null } } }, select: { id: true, status: true } })
    .catch(() => []);
  return new Map(jobs.map((job) => [job.id, job.status]));
}

async function PeriodTab({ userId }: { userId: string }) {
  const data: CleanerInvoiceData | null = await getCleanerInvoiceData({ userId }).catch(() => null);
  if (!data) {
    return <EEmptyState eyebrow="Unavailable" title="Pay summary not available" description="We couldn't load your invoice data right now. Try again shortly." />;
  }
  const [rate, statuses] = await Promise.all([loadRate(userId), loadJobStatuses(userId, data.rows.map((row) => row.jobId))]);
  return (
    <PayPeriod
      periodLabel={`${shortDate(data.start)} – ${shortDate(data.end)}`}
      total={data.estimatedPay}
      jobCount={data.rows.length}
      lines={payPeriodLines(data)}
      rate={rate}
      rows={data.rows.map((row) => ({
        jobId: row.jobId,
        property: row.property,
        date: row.date,
        hours: row.hours,
        amount: row.amount,
        statusLabel: payJobStatusLabel(statuses.get(row.jobId)),
        rateMissing: row.rateMissing,
      }))}
      pendingCount={data.pendingAdjustmentCount}
      pendingAmount={data.pendingAdjustmentAmount}
      gapJobCount={data.gapJobs?.length ?? 0}
    />
  );
}

async function RequestsTab({ userId, jobId }: { userId: string; jobId: string | null }) {
  const options = await loadPayRequestOptions(userId);
  return <PayRequestsPanel jobs={options.jobs} properties={options.properties} initialJobId={jobId} />;
}

/**
 * Cleaner Pay (approved board, 2026-11): This period · Invoices · Requests.
 * /v2/cleaner/invoices and /v2/cleaner/pay-requests redirect to the matching
 * tab with their query (preset, jobId) intact.
 */
export default async function CleanerPayPage({
  searchParams,
}: {
  searchParams?: { tab?: string; preset?: string; jobId?: string };
}) {
  const session = await requireRole([Role.CLEANER]);
  const active = resolvePayTab(searchParams?.tab);
  const preset = INVOICE_PRESETS.includes(searchParams?.preset as InvoicePreset) ? (searchParams?.preset as InvoicePreset) : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <EPageHeader
        eyebrow="Earnings"
        title="Pay"
        description={DESCRIPTIONS[active]}
        actions={active === "period" ? <CleanerInvoiceActions /> : undefined}
      />
      <SegmentTabs
        label="Pay sections"
        activeKey={active}
        tabs={[
          { key: "period", label: "This period", href: "/v2/cleaner/pay" },
          { key: "invoices", label: "Invoices", href: "/v2/cleaner/pay?tab=invoices" },
          { key: "requests", label: "Requests", href: "/v2/cleaner/pay?tab=requests" },
        ]}
      />
      {active === "period" ? <PeriodTab userId={session.user.id} /> : null}
      {active === "invoices" ? <InvoicesPanel initialPreset={preset} /> : null}
      {active === "requests" ? <RequestsTab userId={session.user.id} jobId={searchParams?.jobId ?? null} /> : null}
    </div>
  );
}
