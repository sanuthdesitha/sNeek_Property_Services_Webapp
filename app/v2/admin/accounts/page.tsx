import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { Users, UserCheck, Building2, Wallet } from "lucide-react";
import { getAccountsOverview } from "@/lib/accounts/overview";
import {
  EstateAccountsTabNav,
  type EstateAccountsTabKey,
} from "@/components/v2/admin/accounts-tab-nav";
import {
  EstateStaffManager,
  type AccountRole,
} from "@/components/v2/admin/accounts/staff-manager";
import { EstateBirthdaysCard } from "@/components/v2/admin/accounts/birthdays-card";
import {
  EstateVaManager,
  type EstateVaClientOption,
} from "@/components/v2/admin/accounts/va-manager";
import { EPageHeader, EStatCard } from "@/components/v2/ui/primitives";

export const metadata = { title: "Accounts · Estate admin" };
export const dynamic = "force-dynamic";

const fmtMoney = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

/**
 * One tab per ACCOUNT TYPE.
 *
 * This page is about LOGINS — who can sign in, as what, and with which grants.
 * It is deliberately not a second client list: /v2/admin/clients owns the
 * business view (properties, invoices, jobs), and a client with no portal
 * account belongs there and not here. The two used to overlap, which is why
 * "Clients" appeared twice in the admin with different columns each time.
 *
 * Assistants get their own tab rather than a row in the staff list because a VA
 * login means nothing on its own: the VaTeam owns the client link, the
 * permissions and the property scope. Managing one as a loose user row would
 * strand it.
 */
const TAB_ROLES: Record<
  Exclude<EstateAccountsTabKey, "assistants">,
  { roles: AccountRole[]; createRole: AccountRole; blurb: string }
> = {
  team: {
    roles: ["ADMIN", "OPS_MANAGER", "QA_INSPECTOR"],
    createRole: "OPS_MANAGER",
    blurb: "Admins, ops managers and QA inspectors — the people who run the operation.",
  },
  cleaners: {
    roles: ["CLEANER"],
    createRole: "CLEANER",
    blurb: "Cleaner logins for the field app, with pay and compliance details.",
  },
  clients: {
    roles: ["CLIENT"],
    createRole: "CLIENT",
    blurb:
      "Portal logins belonging to a client. The client record itself — properties, invoices, jobs — lives under Clients.",
  },
  partners: {
    roles: ["LAUNDRY", "MAINTENANCE"],
    createRole: "LAUNDRY",
    blurb: "Laundry and maintenance partners who work jobs but are not staff.",
  },
};

const TAB_KEYS: EstateAccountsTabKey[] = ["team", "cleaners", "clients", "assistants", "partners"];

function normalizeTab(value: string | undefined): EstateAccountsTabKey {
  // "staff" was the old default tab and is still in bookmarks and browser
  // history; landing those on Team is kinder than an empty page.
  if (value === "staff") return "team";
  if (value === "vas") return "assistants";
  return (TAB_KEYS as string[]).includes(value ?? "") ? (value as EstateAccountsTabKey) : "team";
}

export default async function EstateAccountsPage({
  searchParams,
}: {
  searchParams?: { tab?: string };
}) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const tab = normalizeTab(searchParams?.tab);
  const canManage = session.user.role === Role.ADMIN;

  const [overview, vaClients] = await Promise.all([
    getAccountsOverview(30),
    // Only the picker list — a chosen client's teams and properties load from
    // the API, so this stays cheap however many clients exist.
    tab === "assistants"
      ? db.client.findMany({
          where: { isActive: true },
          select: { id: true, name: true, email: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve<EstateVaClientOption[]>([]),
  ]);

  const category = tab === "assistants" ? null : TAB_ROLES[tab];

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Accounts"
        title="Accounts"
        description={
          category?.blurb ??
          "Virtual assistants act for a client, scoped by their team's permissions and properties."
        }
      />

      {/* KPI summary strip — real, cheap metrics only */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <EStatCard label="Total staff" value={overview.totalStaff} icon={<Users className="h-4 w-4" />} />
        <EStatCard
          label="Active cleaners"
          value={overview.activeCleaners}
          icon={<UserCheck className="h-4 w-4" />}
        />
        <EStatCard
          label="Total clients"
          value={overview.totalClients}
          icon={<Building2 className="h-4 w-4" />}
        />
        <EStatCard
          label="Outstanding receivables"
          value={fmtMoney.format(overview.outstandingReceivables)}
          icon={<Wallet className="h-4 w-4" />}
        />
      </section>

      <EstateAccountsTabNav active={tab} />

      {tab === "assistants" ? (
        <EstateVaManager clients={vaClients} canManage={canManage} />
      ) : tab === "team" ? (
        // Birthdays sit beside the internal team only — wishing the ops manager
        // a happy birthday is useful; the same card next to a list of laundry
        // partners is noise.
        <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
          <div className="min-w-0">
            <EstateStaffManager
              canManage={canManage}
              roles={category!.roles}
              createRole={category!.createRole}
            />
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
        <EstateStaffManager
          canManage={canManage}
          roles={category!.roles}
          createRole={category!.createRole}
        />
      )}
    </div>
  );
}
