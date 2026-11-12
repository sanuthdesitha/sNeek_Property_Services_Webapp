import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAccountsOverview } from "@/lib/accounts/overview";
import { resolveAccountsViewer } from "@/lib/accounts/viewer";
import { EMPTY_CLEANER_FIGURES, loadCleanerFigures } from "@/lib/people/cleaner-figures";
import { redirect } from "next/navigation";
import { loadPeopleCounts } from "@/lib/people/counts";
import { allowedPeopleTabs, normalizePeopleTab } from "@/lib/people/tabs";
import { canActAs } from "@/lib/auth/roles";
import { PeopleDirectory } from "@/components/v2/admin/people/people-directory";

export const metadata = { title: "People · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * People: clients and everyone with a login in one directory (owner request,
 * People board 2026-11-12). Tabs: Clients, Cleaners, Office and other staff,
 * Laundry partners and suppliers, Assistants, Invitations; Everyone and Needs
 * attention as chips. Each tab keeps its own columns, filters, bulk actions
 * and side panel. The route stays /v2/admin/accounts (old links keep
 * working); /clients, /cleaners, /users and /workforce lists redirect here.
 *
 * Tabs per pack: Clients (clients pack; data from /api/admin/clients/*),
 * Cleaners (Staff accounts via /api/admin/users, or workforce via
 * /api/admin/people/cleaners, which forces the cleaners list), every other
 * tab Staff accounts. Accounts-only reads are skipped without that pack.
 */
export default async function PeoplePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const viewer = await resolveAccountsViewer(session.user);
  // Each tab is gated by its own pack on the server (ops-catalog
  // PEOPLE_TAB_FEATURES): Clients = clients, Cleaners = Staff accounts or
  // workforce, everything else = Staff accounts. A viewer without Staff
  // accounts gets none of its data in this payload.
  const access = {
    clients: viewer.canSeeClients !== false,
    accounts: viewer.canOpenPeople !== false,
    workforce: viewer.canSeeWorkforce !== false,
  };

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") query.set(key, first);
  }
  const allowed = allowedPeopleTabs(access);
  if (allowed.length === 0) redirect("/v2/admin/access-denied");
  const fallback = allowed[0];
  const requested = normalizePeopleTab(query.get("tab"), fallback);
  const initialTab = allowed.includes(requested) ? requested : fallback;
  const seesCleaners = allowed.includes("cleaners");

  const [overview, vaClients, counts, cleanerFigures] = await Promise.all([
    access.accounts ? getAccountsOverview(30) : Promise.resolve(null),
    // The assistants tab (Staff accounts) picks a client for a new team.
    access.accounts
      ? db.client.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    loadPeopleCounts(access),
    seesCleaners
      ? loadCleanerFigures({ workforce: access.workforce, pay: viewer.visibility.pay })
      : Promise.resolve(EMPTY_CLEANER_FIGURES),
  ]);
  const held = (session.user.heldRoles ?? [session.user.role]) as Role[];

  return (
    <PeopleDirectory
      initialTab={initialTab}
      initialSearch={`?${query.toString()}`}
      access={access}
      capabilities={{
        isAdmin: viewer.isAdmin,
        canOpenPeople: access.accounts,
        canWriteNotes: viewer.canWriteNotes,
        canMessageStaff: viewer.canMessageStaff === true,
        canSeeWorkforce: viewer.canSeeWorkforce !== false,
        canViewAddresses: canActAs(held, [Role.ADMIN]),
      }}
      counts={counts}
      cleanerFigures={cleanerFigures}
      vaClients={vaClients}
      birthdays={(overview?.upcomingBirthdays ?? []).map((b) => ({
        id: b.id,
        name: b.name,
        nextBirthday: b.nextBirthday.toISOString(),
        daysUntil: b.daysUntil,
        turningAge: b.turningAge,
      }))}
    />
  );
}
