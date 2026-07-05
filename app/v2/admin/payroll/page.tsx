import Link from "next/link";
import { format } from "date-fns";
import { PayrollRunStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listPayrollRuns } from "@/lib/payroll/engine";
import { formatCurrency } from "@/lib/utils";
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
import { Banknote, CheckCircle2, Clock, Users } from "lucide-react";

export const metadata = { title: "Payroll · Estate admin" };
export const dynamic = "force-dynamic";

type Tone = "neutral" | "info" | "warning" | "success" | "gold" | "danger";

function statusTone(status: PayrollRunStatus): Tone {
  switch (status) {
    case PayrollRunStatus.COMPLETED:
      return "success";
    case PayrollRunStatus.CONFIRMED:
    case PayrollRunStatus.PROCESSING:
      return "info";
    case PayrollRunStatus.FAILED:
      return "danger";
    case PayrollRunStatus.VOID:
      return "warning";
    default:
      return "neutral";
  }
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

type PayrollRunRow = Awaited<ReturnType<typeof listPayrollRuns>>[number];

async function getRuns(): Promise<PayrollRunRow[]> {
  return listPayrollRuns({ limit: 40 }).catch(() => [] as PayrollRunRow[]);
}

export default async function AdminPayrollPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const runs = await getRuns();

  const completed = runs.filter((r) => r.status === PayrollRunStatus.COMPLETED);
  const pending = runs.filter(
    (r) =>
      r.status === PayrollRunStatus.DRAFT ||
      r.status === PayrollRunStatus.CONFIRMED ||
      r.status === PayrollRunStatus.PROCESSING
  );
  const paidTotal = completed.reduce((sum, r) => sum + (r.grandTotal ?? 0), 0);
  const cleanersLatest = runs[0]?.cleanerCount ?? 0;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Commercial"
        title="Payroll"
        description="Committed pay runs and cleaner payouts."
        actions={
          <EButton asChild variant="gold" size="sm"><Link href="/admin/finance?tab=payroll">New pay run</Link></EButton>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <EStatCard label="Paid · completed runs" value={formatCurrency(paidTotal)} delta={`${completed.length} run${completed.length === 1 ? "" : "s"}`} deltaTone="neutral" icon={<Banknote className="h-4 w-4" />} />
        <EStatCard label="Pending runs" value={String(pending.length)} delta="draft / processing" deltaTone="neutral" icon={<Clock className="h-4 w-4" />} />
        <EStatCard label="Completed" value={String(completed.length)} delta="all time (recent)" deltaTone="neutral" icon={<CheckCircle2 className="h-4 w-4" />} />
        <EStatCard label="Cleaners · latest run" value={String(cleanersLatest)} delta="most recent" deltaTone="neutral" icon={<Users className="h-4 w-4" />} />
      </section>

      <ECard>
        <ECardHeader className="flex-row items-center justify-between">
          <ECardTitle>Pay runs</ECardTitle>
          <EButton asChild variant="ghost" size="sm"><Link href="/admin/finance?tab=payroll">Open pay run tool</Link></EButton>
        </ECardHeader>
        <ECardBody className="pt-0">
          {runs.length === 0 ? (
            <EEmptyState eyebrow="No pay runs yet" title="Nothing to show" description="Committed pay runs will appear here once you process one." />
          ) : (
            <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              <table className="w-full text-[0.8125rem]">
                <thead>
                  <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                    {["Period", "Cleaners", "Grand total", "Status", "Created", ""].map((h) => (
                      <th key={h} className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-t border-[hsl(var(--e-border)/0.7)] hover:bg-[hsl(var(--e-primary-soft)/0.4)]">
                      <td className="px-3 py-3 font-medium whitespace-nowrap">
                        {format(new Date(run.periodStart), "d MMM")} – {format(new Date(run.periodEnd), "d MMM yy")}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-[hsl(var(--e-text-secondary))]">{run.cleanerCount}</td>
                      <td className="px-3 py-3"><span className="e-numeral text-[0.9375rem]">{formatCurrency(run.grandTotal ?? 0)}</span></td>
                      <td className="px-3 py-3"><EBadge tone={statusTone(run.status)} soft>{titleCase(run.status)}</EBadge></td>
                      <td className="px-3 py-3 tabular-nums whitespace-nowrap text-[hsl(var(--e-text-secondary))]">{format(new Date(run.createdAt), "d MMM yy")}</td>
                      <td className="px-3 py-3 text-right"><EButton asChild variant="ghost" size="sm"><Link href={`/admin/payroll/${run.id}`}>View</Link></EButton></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ECardBody>
      </ECard>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · live data · run detail and processing open in the live console.</p>
    </div>
  );
}
