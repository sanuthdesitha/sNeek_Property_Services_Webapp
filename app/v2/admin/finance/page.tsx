import { format } from "date-fns";
import { Role } from "@prisma/client";
import { Banknote, FileWarning, TrendingUp, Wallet } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { getFinanceDashboardData } from "@/lib/finance/dashboard";
import { getFinanceHubSummary } from "@/lib/finance/hub";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { KpiTile } from "@/components/charts";
import { FinanceDashboardWorkspace } from "@/components/admin/finance-dashboard-workspace";
import { ClientInvoicesPage } from "@/components/admin/client-invoices-page";
import { PayrollRunsList } from "@/components/payroll/payroll-runs-list";
import type { FinanceTabKey } from "@/components/admin/finance-tab-nav";
import { FinanceTabNavV2 } from "@/components/v2/admin/finance-tab-nav";

export const metadata = { title: "Finance · Estate admin" };
export const dynamic = "force-dynamic";

const TAB_KEYS: FinanceTabKey[] = ["overview", "invoices", "payroll"];

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
  // The Overview tab reuses the Sphere-UI dashboard data; fetch it only when
  // that tab is active so Invoices/Payroll don't pay for the heavy roll-up.
  const dashboardData = tab === "overview" ? await getFinanceDashboardData() : null;

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
        <KpiTile
          label="Revenue MTD"
          value={money(summary.revenueMtd)}
          icon={<TrendingUp />}
          tone="success"
          href="/v2/admin/finance?tab=overview"
        />
        <KpiTile
          label={`Outstanding · ${summary.outstandingCount} sent`}
          value={money(summary.outstandingReceivables)}
          icon={<FileWarning />}
          tone={summary.outstandingReceivables > 0 ? "warning" : "neutral"}
          href="/v2/admin/finance?tab=invoices"
        />
        <KpiTile
          label="Payroll due (MTD)"
          value={money(summary.payrollDue)}
          icon={<Wallet />}
          tone={summary.payrollDue > 0 ? "info" : "neutral"}
          href="/v2/admin/finance?tab=payroll"
        />
        <KpiTile
          label={`Last run · ${lastRunLabel}`}
          value={summary.lastRun ? money(summary.lastRun.grandTotal) : "—"}
          icon={<Banknote />}
          tone="primary"
          href="/v2/admin/finance?tab=payroll"
        />
      </section>

      <FinanceTabNavV2 active={tab} />

      <div className="min-w-0">
        {tab === "overview" && dashboardData ? (
          <FinanceDashboardWorkspace data={dashboardData} />
        ) : null}
        {tab === "invoices" ? <ClientInvoicesPage /> : null}
        {tab === "payroll" ? (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Payroll runs</h2>
              <p className="text-sm text-muted-foreground">
                Create a payroll run for a period, then review and process cleaner payouts.
              </p>
            </div>
            <PayrollRunsList />
          </div>
        ) : null}
      </div>
    </div>
  );
}
