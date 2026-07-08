import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { JobStatus, Role } from "@prisma/client";
import Link from "next/link";
import { Plus, Users, UserCheck, Building2, Wallet } from "lucide-react";
import { getAccountsOverview } from "@/lib/accounts/overview";
import {
  EstateAccountsTabNav,
  type EstateAccountsTabKey,
} from "@/components/v2/admin/accounts-tab-nav";
import { EstateStaffManager } from "@/components/v2/admin/accounts/staff-manager";
import {
  EstateClientsList,
  type EstateClientRow,
} from "@/components/v2/admin/accounts/clients-list";
import { EstateBirthdaysCard } from "@/components/v2/admin/accounts/birthdays-card";
import { EButton, EPageHeader, EStatCard } from "@/components/v2/ui/primitives";

export const metadata = { title: "Accounts · Estate admin" };
export const dynamic = "force-dynamic";

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.UNASSIGNED,
  JobStatus.OFFERED,
  JobStatus.ASSIGNED,
  JobStatus.EN_ROUTE,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
  JobStatus.WAITING_CONTINUATION_APPROVAL,
  JobStatus.SUBMITTED,
  JobStatus.QA_REVIEW,
];

const fmtMoney = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

const TAB_KEYS: EstateAccountsTabKey[] = ["staff", "clients"];

function normalizeTab(value: string | undefined): EstateAccountsTabKey {
  return (TAB_KEYS as string[]).includes(value ?? "") ? (value as EstateAccountsTabKey) : "staff";
}

async function getClientRows(): Promise<EstateClientRow[]> {
  const clients = await db.client.findMany({
    where: { isActive: true },
    include: { _count: { select: { properties: true } } },
    orderBy: { name: "asc" },
  });

  const clientIds = clients.map((c) => c.id);

  const [activeJobsAgg, latestInvoices] = await Promise.all([
    clientIds.length === 0
      ? Promise.resolve([] as Array<{ clientId: string; count: bigint }>)
      : db.$queryRaw<Array<{ clientId: string; count: bigint }>>`
          SELECT p."clientId" AS "clientId", COUNT(j.*)::bigint AS "count"
          FROM "Job" j
          JOIN "Property" p ON p.id = j."propertyId"
          WHERE p."clientId" = ANY(${clientIds}::text[])
            AND j.status::text = ANY(${ACTIVE_JOB_STATUSES.map((s) => s.toString())}::text[])
          GROUP BY p."clientId"
        `,
    clientIds.length === 0
      ? Promise.resolve([] as Array<{ clientId: string; totalAmount: number; createdAt: Date }>)
      : db.$queryRaw<Array<{ clientId: string; totalAmount: number; createdAt: Date }>>`
          SELECT DISTINCT ON ("clientId") "clientId", "totalAmount", "createdAt"
          FROM "ClientInvoice"
          WHERE "clientId" = ANY(${clientIds}::text[])
          ORDER BY "clientId", "createdAt" DESC
        `,
  ]);

  const activeJobMap = new Map(activeJobsAgg.map((r) => [r.clientId, Number(r.count)]));
  const invoiceMap = new Map(latestInvoices.map((r) => [r.clientId, r]));

  return clients.map((c) => {
    const inv = invoiceMap.get(c.id);
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      propertiesCount: c._count.properties,
      activeJobsCount: activeJobMap.get(c.id) ?? 0,
      lastInvoiceAmount: inv?.totalAmount ?? null,
      lastInvoiceAt: inv?.createdAt?.toISOString() ?? null,
    };
  });
}

export default async function EstateAccountsPage({
  searchParams,
}: {
  searchParams?: { tab?: string };
}) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const tab = normalizeTab(searchParams?.tab);

  const [overview, clientRows] = await Promise.all([
    getAccountsOverview(30),
    tab === "clients" ? getClientRows() : Promise.resolve<EstateClientRow[]>([]),
  ]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Accounts"
        title="Staff & client accounts"
        description="Staff and client accounts in one place — with a rich summary for every account."
        actions={
          tab === "clients" ? (
            <EButton asChild variant="gold" size="sm"><Link href="/v2/admin/clients/new">
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add client
              </Link></EButton>
          ) : null
        }
      />

      {/* KPI summary strip — real, cheap metrics only */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <EStatCard label="Total staff" value={overview.totalStaff} icon={<Users className="h-4 w-4" />} />
        <EStatCard label="Active cleaners" value={overview.activeCleaners} icon={<UserCheck className="h-4 w-4" />} />
        <EStatCard label="Total clients" value={overview.totalClients} icon={<Building2 className="h-4 w-4" />} />
        <EStatCard
          label="Outstanding receivables"
          value={fmtMoney.format(overview.outstandingReceivables)}
          icon={<Wallet className="h-4 w-4" />}
        />
      </section>

      <EstateAccountsTabNav active={tab} />

      {tab === "staff" ? (
        <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
          <div className="min-w-0">
            <EstateStaffManager canManage={session.user.role === Role.ADMIN} />
          </div>
          <div className="space-y-6">
            <EstateBirthdaysCard
              birthdays={overview.upcomingBirthdays.map((b) => ({
                id: b.id,
                name: b.name,
                nextBirthday: b.nextBirthday.toISOString(),
                daysUntil: b.daysUntil,
                turningAge: b.turningAge,
              }))}
            />
          </div>
        </div>
      ) : (
        <EstateClientsList clients={clientRows} />
      )}
    </div>
  );
}
