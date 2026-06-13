import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { JobStatus, Role } from "@prisma/client";
import Link from "next/link";
import { Plus, Users, Building2, UserCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { KpiTile } from "@/components/charts";
import { UsersManager } from "@/components/admin/users-manager";
import { AccountsTabNav, type AccountsTabKey } from "@/components/accounts/accounts-tab-nav";
import { ClientsHubList, type ClientHubRow } from "@/components/accounts/clients-hub-list";
import { BirthdaysCard } from "@/components/accounts/birthdays-card";
import { getAccountsOverview } from "@/lib/accounts/overview";

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

const TAB_KEYS: AccountsTabKey[] = ["staff", "clients"];

function normalizeTab(value: string | undefined): AccountsTabKey {
  return (TAB_KEYS as string[]).includes(value ?? "") ? (value as AccountsTabKey) : "staff";
}

async function getClientRows(): Promise<ClientHubRow[]> {
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

export default async function AccountsHubPage({
  searchParams,
}: {
  searchParams?: { tab?: string };
}) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const tab = normalizeTab(searchParams?.tab);

  const [overview, clientRows] = await Promise.all([
    getAccountsOverview(30),
    tab === "clients" ? getClientRows() : Promise.resolve<ClientHubRow[]>([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Users />}
        title="Accounts"
        description="Staff and client accounts in one place — with a rich summary for every account."
        actions={
          tab === "clients" ? (
            <Button asChild>
              <Link href="/admin/clients/new">
                <Plus className="mr-2 h-4 w-4" />
                Add client
              </Link>
            </Button>
          ) : null
        }
      />

      {/* KPI summary strip — real, cheap metrics only */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon={<Users />} tone="primary" label="Total staff" value={overview.totalStaff} />
        <KpiTile icon={<UserCheck />} tone="success" label="Active cleaners" value={overview.activeCleaners} />
        <KpiTile icon={<Building2 />} tone="info" label="Total clients" value={overview.totalClients} />
        <KpiTile
          icon={<Wallet />}
          tone="warning"
          label="Outstanding receivables"
          value={fmtMoney.format(overview.outstandingReceivables)}
        />
      </section>

      <AccountsTabNav active={tab} />

      {tab === "staff" ? (
        <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
          <div className="min-w-0">
            <UsersManager canManage={session.user.role === Role.ADMIN} embedded />
          </div>
          <div className="space-y-6">
            <BirthdaysCard birthdays={overview.upcomingBirthdays} />
          </div>
        </div>
      ) : (
        <ClientsHubList clients={clientRows} />
      )}
    </div>
  );
}
