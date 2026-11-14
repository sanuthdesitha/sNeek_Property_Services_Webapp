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
import { InvitePersonPage, type InvitePrefill } from "@/components/v2/admin/accounts/invite/invite-person-page";
import { resolveAccountCreator } from "@/lib/accounts/account-creator";
import { inviteRefusal, isAccountKind, type AccountKind } from "@/lib/accounts/create-account-rules";
import { OPS_FEATURES } from "@/lib/rbac/ops-catalog";
import { getSmsProviderState } from "@/lib/notifications/sms";
import { getAppSettings } from "@/lib/settings";
import { loadHirePreview } from "@/lib/hiring/hire";
import type { Session } from "next-auth";

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
function firstParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first : null;
}

/**
 * `?invite=<role>` (board "Invite person", 2026-11-16): the Invite person page
 * replaces the old dialog. Administrators only (the route refuses anyone else
 * too); `&application=<id>` opens it filled from a Hiring application.
 */
async function renderInvitePage(session: Session, invite: string, applicationId: string | null) {
  const creator = await resolveAccountCreator(session);
  if (inviteRefusal(creator)) redirect("/v2/admin/access-denied");
  const requested = invite.toUpperCase();
  const initialKind: AccountKind = isAccountKind(requested) ? requested : "CLEANER";
  const [clients, partners, sms, settings, preview] = await Promise.all([
    db.client.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.laundrySupplier.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getSmsProviderState(),
    getAppSettings(),
    applicationId ? loadHirePreview(applicationId, creator, isAccountKind(requested) ? requested : null).catch(() => null) : Promise.resolve(null),
  ]);
  const prefill: InvitePrefill | null = preview
    ? { applicationId: preview.applicationId, name: preview.name, email: preview.email, phone: preview.phone, kind: preview.accountKind, refusal: preview.refusal }
    : null;
  return (
    <InvitePersonPage
      initialKind={initialKind}
      clients={clients}
      partners={partners}
      opsAreas={OPS_FEATURES.map((feature) => ({ key: feature.key, label: feature.label }))}
      smsReady={sms.provider !== "none" && Boolean(sms.configured)}
      timeZone={settings.timezone || "Australia/Sydney"}
      prefill={prefill}
    />
  );
}

export default async function PeoplePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const invite = firstParam(searchParams?.invite);
  if (invite) return renderInvitePage(session, invite, firstParam(searchParams?.application));
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
