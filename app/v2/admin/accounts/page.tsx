import Link from "next/link";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getAccountsOverview } from "@/lib/accounts/overview";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
  EPageHeader,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { Users, UserCheck, Building2, Wallet, ArrowUpRight, Cake } from "lucide-react";

export const metadata = { title: "Accounts · Estate admin" };
export const dynamic = "force-dynamic";

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

function roleLabel(role: Role): string {
  return String(role).replace(/_/g, " ");
}

type StaffRow = {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  isActive: boolean;
};

async function getStaff(): Promise<StaffRow[]> {
  return db.user
    .findMany({
      where: { role: { not: Role.CLIENT } },
      select: { id: true, name: true, email: true, role: true, isActive: true },
      orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
      take: 50,
    })
    .catch(() => [] as StaffRow[]);
}

export default async function EstateAccountsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const [overview, staff] = await Promise.all([
    getAccountsOverview(30).catch(() => ({
      totalStaff: 0,
      activeCleaners: 0,
      totalClients: 0,
      outstandingReceivables: 0,
      upcomingBirthdays: [],
    })),
    getStaff(),
  ]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Accounts"
        title="Staff & client accounts"
        description="Every account in one place, with a live roll-up of your workspace."
        actions={
          <Link href="/admin/accounts">
            <EButton variant="gold" size="sm">
              Manage in full hub <ArrowUpRight className="h-3.5 w-3.5" />
            </EButton>
          </Link>
        }
      />

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

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <ECard>
          <ECardBody className="pt-6">
            {staff.length === 0 ? (
              <EEmptyState
                eyebrow="No staff yet"
                title="No staff accounts"
                description="Create staff accounts from the full accounts hub."
              />
            ) : (
              <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                <table className="w-full text-[0.8125rem]">
                  <thead>
                    <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                      {["Member", "Role", "Status", ""].map((h) => (
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
                    {staff.map((u) => (
                      <tr
                        key={u.id}
                        className="border-t border-[hsl(var(--e-border)/0.7)] hover:bg-[hsl(var(--e-primary-soft)/0.4)]"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span
                              className="flex h-8 w-8 items-center justify-center rounded-full text-[0.6875rem] font-semibold text-[hsl(var(--e-accent-portal-foreground))]"
                              style={{ backgroundColor: "hsl(var(--e-accent-portal))" }}
                            >
                              {initials(u.name, u.email)}
                            </span>
                            <div className="min-w-0">
                              <span className="font-[550]">{u.name ?? "Unnamed"}</span>
                              <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <EBadge tone="neutral" soft>
                            {roleLabel(u.role)}
                          </EBadge>
                        </td>
                        <td className="px-4 py-3">
                          <EBadge tone={u.isActive ? "primary" : "neutral"} soft>
                            {u.isActive ? "Active" : "Disabled"}
                          </EBadge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/admin/accounts/users/${u.id}`}>
                            <EButton variant="ghost" size="sm">
                              Profile
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

        <ECard>
          <ECardBody className="pt-6">
            <div className="mb-3 flex items-center gap-2 text-[hsl(var(--e-text-secondary))]">
              <Cake className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" />
              <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">
                Upcoming birthdays
              </span>
            </div>
            {overview.upcomingBirthdays.length === 0 ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">None in the next 30 days.</p>
            ) : (
              <ul className="space-y-2.5">
                {overview.upcomingBirthdays.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[0.8125rem] font-[550]">{b.name ?? "Unnamed"}</p>
                      <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{roleLabel(b.role)}</p>
                    </div>
                    <EBadge tone={b.daysUntil === 0 ? "gold" : "neutral"} soft>
                      {b.daysUntil === 0 ? "Today" : `${b.daysUntil}d`}
                    </EBadge>
                  </li>
                ))}
              </ul>
            )}
          </ECardBody>
        </ECard>
      </div>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Estate preview · live data from your workspace. Creating, editing and disabling accounts stays in the{" "}
        <Link href="/admin/accounts" className="underline">
          full accounts hub
        </Link>
        .
      </p>
    </div>
  );
}
