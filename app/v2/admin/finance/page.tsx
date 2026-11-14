import { format } from "date-fns";
import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getFinanceDashboardData } from "@/lib/finance/dashboard";
import { getFinanceHubSummary } from "@/lib/finance/hub";
import { listPayrollRuns } from "@/lib/payroll/engine";
import { getMoneyAttentionCounts } from "@/lib/admin/attention-counts";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { canUseOpsPath } from "@/lib/rbac/ops-catalog";
import { getXeroStatus } from "@/lib/xero/client";
import { readXeroSyncStatus } from "@/lib/billing/client-invoice-xero-sync";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EKpiLink } from "@/components/v2/admin/estate-kit";
import { cn } from "@/lib/utils";
import { FinanceTabNavV2 } from "@/components/v2/admin/finance-tab-nav";
import { FINANCE_TAB_LABEL, type FinanceTabKey } from "@/components/v2/admin/finance-tab-labels";
import { MoneyHeaderActions, type XeroConnectionSummary } from "@/components/v2/admin/finance/money-header-actions";
import { FinanceOverview } from "@/components/v2/admin/finance/finance-overview";
import { EstateInvoices } from "@/components/v2/admin/finance/estate-invoices";
import { EstatePayroll, type EstatePayrollRun } from "@/components/v2/admin/finance/estate-payroll";
import { EstatePayAdjustments } from "@/components/v2/admin/finance/pay-adjustments";
import { EstateTimeAdjustments } from "@/components/v2/admin/finance/time-adjustments";
import { CleanerInvoicesTabs } from "@/components/v2/admin/cleaner-invoices/cleaner-invoices-tabs";

export const metadata = { title: "Invoices and pay · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Invoices and pay: client invoices, cleaner invoices, pay runs, adjustments
 * and the finance overview on one page. /v2/admin/payroll and
 * /v2/admin/cleaner-invoices redirect here. Every old `?tab=` value still
 * lands on its content: `invoices`, `payroll`, `adjustments`, `time` and
 * `overview`, plus the new `cleaner-invoices`.
 */
const TAB_ORDER: FinanceTabKey[] = ["invoices", "cleaner-invoices", "payroll", "adjustments", "overview"];
type AdjustmentsView = "pay" | "time";

function resolveTab(raw: string | undefined): { tab: FinanceTabKey | null; adjustments: AdjustmentsView } {
  if (raw === "time") return { tab: "adjustments", adjustments: "time" };
  if (raw && (TAB_ORDER as string[]).includes(raw)) return { tab: raw as FinanceTabKey, adjustments: "pay" };
  return { tab: null, adjustments: "pay" };
}

function money(value: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

async function readXero(): Promise<XeroConnectionSummary> {
  try {
    const status = await getXeroStatus();
    if (!status) return { state: "not-connected" };
    if (status.signIn === "lapsed") return { state: "lapsed", tenantName: status.tenantName ?? null };
    // The last renewal failed for now (retried automatically): not reported as connected.
    if (status.state === "attention") return { state: "unknown" };
    // The last whole hourly check against Xero that read everything it asked
    // for; not XeroConnection.lastSyncAt, which only records a token refresh.
    const sync = await readXeroSyncStatus().catch(() => ({ lastSuccessAt: null }));
    return { state: "connected", tenantName: status.tenantName ?? null, lastSyncAt: sync.lastSuccessAt, renewable: status.hasRefreshToken !== false };
  } catch {
    return { state: "unknown" };
  }
}

async function loadPayroll() {
  const [runs, cleaners] = await Promise.all([
    listPayrollRuns({ limit: 50 }),
    db.user.findMany({
      where: { role: Role.CLEANER, isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const rows: EstatePayrollRun[] = runs.map((run) => ({
    id: run.id,
    periodStart: run.periodStart instanceof Date ? run.periodStart.toISOString() : String(run.periodStart),
    periodEnd: run.periodEnd instanceof Date ? run.periodEnd.toISOString() : String(run.periodEnd),
    status: String(run.status),
    grandTotal: Number(run.grandTotal ?? 0),
    cleanerCount: run.cleanerCount ?? run.payouts.length,
    createdAt: run.createdAt instanceof Date ? run.createdAt.toISOString() : String(run.createdAt),
    paidCount: run.payouts.filter((p) => p.status === "PAID").length,
    payoutCount: run.payouts.length,
  }));
  return { runs: rows, cleaners: cleaners.map((c) => ({ id: c.id, name: c.name || c.email || "Cleaner" })) };
}

async function PayRunsTab() {
  const [summary, payroll] = await Promise.all([getFinanceHubSummary(), loadPayroll()]);
  const lastRunLabel = summary.lastRun
    ? `${format(new Date(summary.lastRun.periodStart), "dd MMM")} – ${format(new Date(summary.lastRun.periodEnd), "dd MMM")}`
    : "No runs yet";
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <EKpiLink label="Payroll due (MTD)" value={money(summary.payrollDue)} tone={summary.payrollDue > 0 ? "info" : "neutral"} />
        <EKpiLink label={`Last run · ${lastRunLabel}`} value={summary.lastRun ? money(summary.lastRun.grandTotal) : "—"} tone="gold" />
      </section>
      <EstatePayroll runs={payroll.runs} cleaners={payroll.cleaners} />
    </div>
  );
}

async function OverviewTab({ canReviewCosts }: { canReviewCosts: boolean }) {
  const [summary, data] = await Promise.all([getFinanceHubSummary(), getFinanceDashboardData()]);
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <EKpiLink label="Revenue MTD" value={money(summary.revenueMtd)} />
        <EKpiLink
          label={`Outstanding · ${summary.outstandingCount} issued`}
          value={money(summary.outstandingReceivables)}
          tone={summary.outstandingReceivables > 0 ? "warning" : "neutral"}
          href="/v2/admin/finance?tab=invoices&status=SENT"
        />
      </section>
      <FinanceOverview data={data} canReviewCosts={canReviewCosts} />
    </div>
  );
}

function AdjustmentsTab({ view }: { view: AdjustmentsView }) {
  const links: Array<{ key: AdjustmentsView; label: string; tab: string }> = [
    { key: "pay", label: "Pay adjustments", tab: "adjustments" },
    { key: "time", label: "Time adjustments", tab: "time" },
  ];
  return (
    <div className="space-y-4">
      <nav aria-label="Adjustments and time" className="flex flex-wrap gap-1.5">
        {links.map((link) => (
          <Link
            key={link.key}
            href={`/v2/admin/finance?tab=${link.tab}`}
            scroll={false}
            aria-current={view === link.key ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center rounded-[var(--e-radius-pill)] border px-3 text-[0.8125rem] font-[500]",
              view === link.key
                ? "border-[hsl(var(--e-primary)/0.35)] bg-[hsl(var(--e-primary-soft))] font-[600] text-[hsl(var(--e-primary))]"
                : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-text-secondary))]",
            )}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      {view === "time" ? <EstateTimeAdjustments /> : <EstatePayAdjustments />}
    </div>
  );
}

export default async function AdminFinancePage({ searchParams }: { searchParams?: { tab?: string } }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  // ADMIN: full rights. OPS_MANAGER: only the tabs their packs allow, using
  // the same tab → feature mapping middleware applies to this page.
  const levels = await getOpsAccess(session.user);
  const allowed = TAB_ORDER.filter((key) => !levels || canUseOpsPath(levels, `/v2/admin/finance?tab=${key}`));
  const requested = resolveTab(searchParams?.tab);
  const tab: FinanceTabKey | null = requested.tab
    ? allowed.includes(requested.tab)
      ? requested.tab
      : null
    : (allowed[0] ?? null);

  const [badges, xero] = await Promise.all([getMoneyAttentionCounts(), readXero()]);
  const canBill = allowed.includes("invoices");

  return (
    <div className="space-y-5">
      <EPageHeader
        title="Invoices and pay"
        description="Money in and money out on one page: client invoices, cleaner invoices, pay runs and adjustments."
        actions={<MoneyHeaderActions xero={xero} canBill={canBill} newInvoiceDockedOnPhone={tab === "invoices"} />}
      />
      <FinanceTabNavV2
        active={tab ?? "invoices"}
        tabs={allowed}
        badges={{
          clientToSend: canBill ? badges.clientInvoicesToSend : null,
          cleanerToReview: allowed.includes("cleaner-invoices") ? badges.cleanerInvoices : null,
        }}
      />
      <div className="min-w-0">
        <h2 className="sr-only">{tab ? FINANCE_TAB_LABEL[tab] : "Not available"}</h2>
        {tab === null ? (
          <p role="alert" className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
            This section is not available to your account.
          </p>
        ) : null}
        {tab === "invoices" ? <EstateInvoices /> : null}
        {tab === "cleaner-invoices" ? (
          <div className="space-y-4">
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              Predict what each cleaner will invoice before they submit, then review and settle the invoices they have sent —
              approve{session.user.role === Role.ADMIN ? "" : " (administrators only)"}, push to Xero, record payment, reverse or
              delete (a reversed or deleted invoice lets the cleaner resend a corrected one).
            </p>
            <CleanerInvoicesTabs role={session.user.role} />
          </div>
        ) : null}
        {tab === "payroll" ? <PayRunsTab /> : null}
        {tab === "adjustments" ? <AdjustmentsTab view={requested.adjustments} /> : null}
        {tab === "overview" ? <OverviewTab canReviewCosts={session.user.role === Role.ADMIN} /> : null}
      </div>
    </div>
  );
}
