import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAccountsOverview } from "@/lib/accounts/overview";
import { resolveAccountsViewer } from "@/lib/accounts/viewer";
import { loadCleanerFigures } from "@/lib/people/cleaner-figures";
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
 * The Clients tab is shown to those who could open Clients before (ADMIN, or
 * OPS_MANAGER with the clients pack); its data comes from /api/admin/clients/*
 * which the middleware gates by that pack.
 */
export default async function PeoplePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const viewer = await resolveAccountsViewer(session.user);
  const access = { clients: viewer.canSeeClients !== false };

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") query.set(key, first);
  }
  const allowed = allowedPeopleTabs(access);
  const fallback = access.clients ? "clients" : "cleaners";
  const requested = normalizePeopleTab(query.get("tab"), fallback);
  const initialTab = allowed.includes(requested) ? requested : fallback;

  const [overview, vaClients, counts, cleanerFigures] = await Promise.all([
    getAccountsOverview(30),
    db.client.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    loadPeopleCounts(access),
    loadCleanerFigures({ workforce: viewer.canSeeWorkforce !== false, pay: viewer.visibility.pay }),
  ]);
  const held = (session.user.heldRoles ?? [session.user.role]) as Role[];

  return (
    <PeopleDirectory
      initialTab={initialTab}
      initialSearch={`?${query.toString()}`}
      access={access}
      capabilities={{
        isAdmin: viewer.isAdmin,
        canWriteNotes: viewer.canWriteNotes,
        canMessageStaff: viewer.canMessageStaff === true,
        canSeeWorkforce: viewer.canSeeWorkforce !== false,
        canViewAddresses: canActAs(held, [Role.ADMIN]),
      }}
      counts={counts}
      cleanerFigures={cleanerFigures}
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
