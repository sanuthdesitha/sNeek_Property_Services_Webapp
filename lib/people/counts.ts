/**
 * Real counts for the People header line and tab labels, read in a handful of
 * cheap queries. A count that could not be read is null (shown as "–").
 */
import "server-only";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { loadSupplierDirectory } from "@/lib/laundry/partners";

export type PeopleCounts = {
  clients: number | null;
  cleaners: number | null;
  office: number | null;
  partners: number | null;
  assistants: number | null;
  invitationsOpen: number | null;
  everyone: number | null;
};

const OFFICE_ROLES: Role[] = [Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR, Role.MAINTENANCE];

async function orNull<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch {
    return null;
  }
}

export async function loadPeopleCounts(options: { clients: boolean }, now: Date = new Date()): Promise<PeopleCounts> {
  const [clients, byRole, invitations, suppliers] = await Promise.all([
    options.clients ? orNull(db.client.count()) : Promise.resolve(null),
    orNull(db.user.groupBy({ by: ["role"], _count: { _all: true } })),
    orNull(db.userInvitation.count({ where: { acceptedAt: null, expiresAt: { gt: now } } })),
    orNull(loadSupplierDirectory()),
  ]);
  const roleCount = (roles: Role[]) => (byRole ? byRole.filter((row) => roles.includes(row.role)).reduce((sum, row) => sum + row._count._all, 0) : null);
  const laundryLogins = roleCount([Role.LAUNDRY]);
  return {
    clients,
    cleaners: roleCount([Role.CLEANER]),
    office: roleCount(OFFICE_ROLES),
    // Laundry logins plus supplier records (a linked pair is one supplier row).
    partners: laundryLogins === null || !suppliers ? null : laundryLogins + suppliers.rows.length,
    assistants: roleCount([Role.VA]),
    invitationsOpen: invitations,
    everyone: byRole ? byRole.reduce((sum, row) => sum + row._count._all, 0) : null,
  };
}
