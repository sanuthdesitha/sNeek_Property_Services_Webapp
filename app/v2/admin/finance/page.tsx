import { format } from "date-fns";
import { Role } from "@prisma/client";
import { Banknote, FileWarning, TrendingUp, Wallet } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getFinanceDashboardData } from "@/lib/finance/dashboard";
import { getFinanceHubSummary } from "@/lib/finance/hub";
import { listPayrollRuns } from "@/lib/payroll/engine";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EKpiLink } from "@/components/v2/admin/estate-kit";
import { FinanceTabNavV2 } from "@/components/v2/admin/finance-tab-nav";
import { FinanceOverview } from "@/components/v2/admin/finance/finance-overview";
import { EstateInvoices } from "@/components/v2/admin/finance/estate-invoices";
import {
  EstatePayroll,
  type EstatePayrollRun,
} from "@/components/v2/admin/finance/estate-payroll";
import { EstatePayAdjustments } from "@/components/v2/admin/finance/pay-adjustments";

export const metadata = { title: "Finance · Estate admin" };
export const dynamic = "force-dynamic";

type FinanceTabKey = "overview" | "invoices" | "payroll" | "adjustments";
const TAB_KEYS: FinanceTabKey[] = ["overview", "invoices", "payroll", "adjustments"];

function normalizeTab(value: string | undefined): FinanceTabKey {
  return (TAB_KEYS as string[]).includes(value ?? "") ? (value as FinanceTabKey) : "overview";
}

function money(value: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

export default async function AdminFinancePage({
  searchParams,
}: {
  searchParams?: { tab?: string };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const tab = normalizeTab(searchParams?.tab);

  // KPI strip metrics — all from existing finance/payroll/invoice queries.
  const summary = await getFinanceHubSummary();
  // Overview reuses the finance dashboard roll-up; only fetched on that tab.
  const dashboardData = tab === "overview" ? await getFinanceDashboardData() : null;

  // Payroll tab data — same source lib the v1 list fetched over its API.
  const payrollData =
    tab === "payroll"
      ? await (async () => {
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
            periodStart:
              run.periodStart instanceof Date ? run.periodStart.toISOString() : String(run.periodStart),
            periodEnd: run.periodEnd instanceof Date ? run.periodEnd.toISOString() : String(run.periodEnd),
            status: String(run.status),
            grandTotal: Number(run.grandTotal ?? 0),
            cleanerCount: run.cleanerCount ?? run.payouts.length,
            createdAt:
              run.createdAt instanceof Date ? run.createdAt.toISOString() : String(run.createdAt),
            paidCount: run.payouts.filter((p) => p.status === "PAID").length,
            payoutCount: run.payouts.length,
          }));
          return {
            runs: rows,
            cleaners: cleaners.map((c) => ({ id: c.id, name: c.name || c.email || "Cleaner" })),
          };
        })()
      : null;

  const lastRunLabel = summary.lastRun
    ? `${format(new Date(summary.lastRun.periodStart), "dd MMM")} – ${format(new Date(summary.lastRun.periodEnd), "dd MMM")}`
    : "No runs yet";

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Commercial"
        title="Finance"
        description="Revenue analytics, client invoices, and cleaner payroll — all in one place."
      />

      {/* KPI summary strip — real metrics only. */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <EKpiLink
          label="Revenue MTD"
          value={money(summary.revenueMtd)}
          icon={<TrendingUp />}
          href="/v2/admin/finance?tab=overview"
        />
        <EKpiLink
          label={`Outstanding · ${summary.outstandingCount} sent`}
          value={money(summary.outstandingReceivables)}
          icon={<FileWarning />}
          tone={summary.outstandingReceivables > 0 ? "warning" : "neutral"}
          href="/v2/admin/finance?tab=invoices"
        />
        <EKpiLink
          label="Payroll due (MTD)"
          value={money(summary.payrollDue)}
          icon={<Wallet />}
          tone={summary.payrollDue > 0 ? "info" : "neutral"}
          href="/v2/admin/finance?tab=payroll"
        />
        <EKpiLink
          label={`Last run · ${lastRunLabel}`}
          value={summary.lastRun ? money(summary.lastRun.grandTotal) : "—"}
          icon={<Banknote />}
          tone="gold"
          href="/v2/admin/finance?tab=payroll"
        />
      </section>

      <FinanceTabNavV2 active={tab} />

      <div className="min-w-0">
        {tab === "overview" && dashboardData ? <FinanceOverview data={dashboardData} /> : null}
        {tab === "invoices" ? <EstateInvoices /> : null}
        {tab === "payroll" && payrollData ? (
          <EstatePayroll runs={payrollData.runs} cleaners={payrollData.cleaners} />
        ) : null}
        {tab === "adjustments" ? <EstatePayAdjustments /> : null}
      </div>
    </div>
  );
}
