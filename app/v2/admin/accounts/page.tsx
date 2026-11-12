import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAccountsOverview } from "@/lib/accounts/overview";
import { resolveAccountsViewer } from "@/lib/accounts/viewer";
import { AccountsHub } from "@/components/v2/admin/accounts/hub/accounts-hub";
import { readAccountsView } from "@/components/v2/admin/accounts/hub/accounts-view";

export const metadata = { title: "Accounts · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Accounts: every login in one table, with role tabs, server paging and
 * sorting, bulk actions and a person panel edited section by section.
 *
 * This page is about LOGINS. The client business record (properties,
 * invoices, jobs) stays under Clients, and receivables live in Finance.
 * Old `?tab=team|cleaners|clients|assistants|partners` links still land on
 * the matching tab.
 */
export default async function EstateAccountsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const viewer = await resolveAccountsViewer(session.user);

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") query.set(key, first);
  }

  const [overview, vaClients] = await Promise.all([
    getAccountsOverview(30),
    // Only the picker list for the VA team manager; a chosen client's teams
    // load from the API.
    db.client.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <AccountsHub
      initialView={readAccountsView(`?${query.toString()}`)}
      capabilities={{ isAdmin: viewer.isAdmin, canWriteNotes: viewer.canWriteNotes, canMessageStaff: viewer.canMessageStaff === true }}
      vaClients={vaClients}
      birthdays={overview.upcomingBirthdays.map((b) => ({
        id: b.id,
        name: b.name,
        nextBirthday: b.nextBirthday.toISOString(),
        daysUntil: b.daysUntil,
        turningAge: b.turningAge,
      }))}
    />
  );
}
