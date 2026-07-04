import Link from "next/link";
import { JobStatus, PayAdjustmentStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
  EPageHeader,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { Users, UserCheck, Briefcase, Wallet, ArrowUpRight } from "lucide-react";

export const metadata = { title: "Cleaners · Estate admin" };
export const dynamic = "force-dynamic";

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.ASSIGNED,
  JobStatus.OFFERED,
  JobStatus.EN_ROUTE,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
];

const fmtMoney = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

function initials(name: string | null, email: string): string {
  const src = name || email;
  return (
    src
      .replace(/[^A-Za-z ]/g, "")
      .split(" ")
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

async function getCleaners() {
  const cleaners = await db.user
    .findMany({
      where: { role: Role.CLEANER },
      select: { id: true, name: true, email: true, phone: true, isActive: true, hourlyRate: true },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    })
    .catch(() => [] as Array<{
      id: string;
      name: string | null;
      email: string;
      phone: string | null;
      isActive: boolean;
      hourlyRate: number | null;
    }>);

  const [payRows, activeRows] = await Promise.all([
    db.cleanerPayAdjustment
      .groupBy({
        by: ["cleanerId"],
        where: { status: PayAdjustmentStatus.APPROVED },
        _sum: { approvedAmount: true },
      })
      .catch(() => [] as Array<{ cleanerId: string; _sum: { approvedAmount: number | null } }>),
    db.jobAssignment
      .groupBy({
        by: ["userId"],
        where: { removedAt: null, job: { status: { in: ACTIVE_JOB_STATUSES } } },
        _count: { _all: true },
      })
      .catch(() => [] as Array<{ userId: string; _count: { _all: number } }>),
  ]);

  const payById = new Map(payRows.map((r) => [r.cleanerId, Number(r._sum.approvedAmount ?? 0)]));
  const activeById = new Map(activeRows.map((r) => [r.userId, r._count._all]));

  return cleaners.map((c) => ({
    ...c,
    activeJobs: activeById.get(c.id) ?? 0,
    outstandingPay: payById.get(c.id) ?? 0,
  }));
}

export default async function EstateCleanersPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const rows = await getCleaners();
  const activeCount = rows.filter((r) => r.isActive).length;
  const activeJobs = rows.reduce((s, r) => s + r.activeJobs, 0);
  const owed = rows.reduce((s, r) => s + r.outstandingPay, 0);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Workforce"
        title="Cleaners"
        description="Your cleaning team at a glance — workload, pay and status."
        actions={
          <Link href="/admin/cleaners">
            <EButton variant="gold" size="sm">
              Full cleaners hub <ArrowUpRight className="h-3.5 w-3.5" />
            </EButton>
          </Link>
        }
      />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <EStatCard label="Cleaners" value={rows.length} icon={<Users className="h-4 w-4" />} />
        <EStatCard label="Active" value={activeCount} icon={<UserCheck className="h-4 w-4" />} />
        <EStatCard label="Active jobs" value={activeJobs} icon={<Briefcase className="h-4 w-4" />} />
        <EStatCard label="Owed (approved)" value={fmtMoney.format(owed)} icon={<Wallet className="h-4 w-4" />} />
      </section>

      <ECard>
        <ECardBody className="pt-6">
          {rows.length === 0 ? (
            <EEmptyState
              eyebrow="No cleaners yet"
              title="Your team is empty"
              description="Add cleaners from the full accounts hub."
            />
          ) : (
            <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              <table className="w-full text-[0.8125rem]">
                <thead>
                  <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                    {["Cleaner", "Rate", "Active jobs", "Owed", "Status", ""].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2.5 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr
                      key={c.id}
                      className="border-t border-[hsl(var(--e-border)/0.7)] hover:bg-[hsl(var(--e-primary-soft)/0.4)]"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[0.6875rem] font-semibold text-[hsl(var(--e-accent-portal-foreground))]"
                            style={{ backgroundColor: "hsl(var(--e-accent-portal))" }}
                          >
                            {initials(c.name, c.email)}
                          </span>
                          <div className="min-w-0">
                            <span className="font-[550]">{c.name ?? "Unnamed cleaner"}</span>
                            <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{c.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-[hsl(var(--e-text-secondary))]">
                        {c.hourlyRate !== null ? `$${c.hourlyRate.toFixed(2)}/hr` : "—"}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-[hsl(var(--e-text-secondary))]">{c.activeJobs}</td>
                      <td className="px-4 py-3">
                        <span className="e-numeral text-[0.9375rem]">{fmtMoney.format(c.outstandingPay)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <EBadge tone={c.isActive ? "primary" : "neutral"} soft>
                          {c.isActive ? "Active" : "Inactive"}
                        </EBadge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/admin/workforce/performance/${c.id}`}>
                          <EButton variant="ghost" size="sm">
                            Performance
                          </EButton>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ECardBody>
      </ECard>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Estate preview · live data from your workspace. Add payments, toggle status and view full metrics in the{" "}
        <Link href="/admin/cleaners" className="underline">
          full cleaners hub
        </Link>
        .
      </p>
    </div>
  );
}
