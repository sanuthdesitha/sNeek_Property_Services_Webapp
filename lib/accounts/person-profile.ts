/**
 * Everything the person panel and the full account page show about one
 * account, loaded once on the server. The panel reads it through
 * `GET /api/admin/users/[id]`; the full page calls it directly. Both render the
 * same section components, so the two views cannot drift.
 *
 * Never selected here: password hash, TOTP secret, backup codes, invitation
 * token, session rows. Bank and ABN details are included exactly as the
 * account page showed them before (to ADMIN and OPS_MANAGER, the only roles
 * admitted).
 *
 * Jobs 30 d and QA 30 d come from the Quality hub's basis (one source with the
 * list); the other KPIs from lib/workforce/performance, as before.
 */
import "server-only";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { getUserSummary } from "@/lib/accounts/user-summary";
import { getUserExtendedProfile } from "@/lib/accounts/user-details";
import { formatBirthday } from "@/lib/accounts/overview";
import { getPerformanceMetrics } from "@/lib/workforce/performance";
import { resolveCredentialStatuses } from "@/lib/workforce/credential-expiry";
import { getAppSettings } from "@/lib/settings";
import { cleanTotals } from "@/lib/quality/cleans";
import { loadCleanFacts } from "@/lib/quality/facts";
import { resolveQualityPeriod } from "@/lib/quality/period";
import { EMPTY_QUALITY_FILTERS } from "@/lib/quality/types";
import { accountStatus, inviteAgeDays } from "@/lib/accounts/list/attention";
import { listCleanerAvailabilities } from "@/lib/accounts/availability";
import { buildPayrollIdentity } from "./person-payroll";
import type { RawPersonProfile } from "./person-types";

/** Roles an admin can "Test as" (the impersonation console's list; ADMIN and VA are absent). */
export const TESTABLE_ROLES: readonly Role[] = [Role.CLEANER, Role.CLIENT, Role.QA_INSPECTOR, Role.LAUNDRY, Role.MAINTENANCE, Role.OPS_MANAGER];
const FIELD_ROLES: readonly Role[] = [Role.CLEANER, Role.QA_INSPECTOR];

const PERSON_SELECT = {
  id: true, name: true, email: true, emailVerified: true, phone: true, image: true, role: true, isActive: true,
  hourlyRate: true, dateOfBirth: true, hireDate: true, createdAt: true, employmentType: true,
  suburb: true, state: true, postcode: true, address: true, abn: true,
  visaStatus: true, visaExpiry: true, driverLicenseExpiry: true, vehicleRegoExpiry: true,
  bankBsb: true, bankAccountNumber: true, bankAccountName: true, preferredPayoutMethod: true,
  emergencyContactName: true, emergencyContactPhone: true, emergencyContactRelation: true,
  notes: true, adminNotes: true, clientId: true, twoFactorEnabled: true, profileEditingEnabled: true, lastSeenAt: true,
  client: { select: { id: true, name: true } },
  invitation: { select: { createdAt: true, acceptedAt: true, expiresAt: true } },
  vaTeam: { select: { id: true, name: true, isActive: true, permissions: true, propertyIds: true, client: { select: { id: true, name: true } } } },
} as const;

/** The roster summary line the old staff list showed under a cleaner ("Fixed · 3 weekly days · 1 override"). */
async function availabilitySummary(userId: string): Promise<string | null> {
  const [row] = await listCleanerAvailabilities([userId]);
  if (!row) return null;
  const weeklyDays = Object.keys(row.weekly ?? {}).length;
  const overrides = Object.keys(row.dateOverrides ?? {}).length;
  const mode = row.mode === "FLEXIBLE" ? "Flexible" : "Fixed";
  return `${mode} · ${weeklyDays} weekly day${weeklyDays === 1 ? "" : "s"}` + (overrides > 0 ? ` · ${overrides} override${overrides === 1 ? "" : "s"}` : "");
}

async function qualityFigures(userId: string, now: Date) {
  const period = resolveQualityPeriod({ period: "30d" }, now);
  const totals = cleanTotals(await loadCleanFacts(period, { ...EMPTY_QUALITY_FILTERS, cleanerId: userId }), period);
  return { jobs30: totals.cleans, reviewed30: totals.reviewed, qa30: totals.avgScore };
}

export async function loadPersonProfile(userId: string, now: Date = new Date()): Promise<RawPersonProfile | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: PERSON_SELECT });
  if (!user) return null;

  const isFieldRole = FIELD_ROLES.includes(user.role);
  const scopeIds = Array.isArray(user.vaTeam?.propertyIds)
    ? (user.vaTeam!.propertyIds as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  const [summary, extended, perf, figures, documents, requests, extraRoles, settings, scopeProperties, availability] = await Promise.all([
    getUserSummary(user.id, user.hourlyRate),
    getUserExtendedProfile(user.id),
    isFieldRole ? getPerformanceMetrics(user.id, 30) : Promise.resolve(null),
    user.role === Role.CLEANER ? qualityFigures(user.id, now) : Promise.resolve(null),
    db.staffDocument.findMany({
      where: { userId: user.id },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "desc" }],
      select: { id: true, title: true, category: true, status: true, fileName: true, url: true, expiresAt: true, createdAt: true },
    }),
    db.staffDocumentRequest.findMany({
      where: { userId: user.id, status: "REQUESTED" },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, category: true, dueAt: true, createdAt: true },
    }),
    db.userRole.findMany({
      where: { userId: user.id },
      orderBy: { grantedAt: "asc" },
      select: { role: true, grantedAt: true, grantedBy: { select: { id: true, name: true, email: true } } },
    }),
    getAppSettings(),
    user.role === Role.VA && scopeIds.length > 0
      ? db.property.findMany({ where: { id: { in: scopeIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    user.role === Role.CLEANER ? availabilitySummary(user.id).catch(() => null) : Promise.resolve(null),
  ]);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    phone: user.phone,
    image: user.image,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role],
    isActive: user.isActive,
    status: accountStatus(user),
    inviteAgeDays: inviteAgeDays(user, now),
    invitationExpiresAt: user.invitation && !user.invitation.acceptedAt ? user.invitation.expiresAt : null,
    twoFactorEnabled: user.twoFactorEnabled,
    profileEditingEnabled: user.profileEditingEnabled,
    profileEditOverride: settings.profileEditOverrides[user.id] ?? null,
    roleEditDefault: settings.profileEditPolicy[user.role] ?? null,
    createdAt: user.createdAt,
    hireDate: user.hireDate,
    employmentType: user.employmentType,
    birthday: user.dateOfBirth ? formatBirthday(new Date(user.dateOfBirth)) : null,
    lastSeenAt: user.lastSeenAt,
    availability,
    location: { suburb: user.suburb, state: user.state, postcode: user.postcode, address: user.address },
    client: user.client,
    hourlyRate: user.hourlyRate,
    extraRoles: extraRoles.map((row) => ({ role: row.role, label: ROLE_LABELS[row.role], grantedAt: row.grantedAt, grantedBy: row.grantedBy })),
    ownNotes: user.notes,
    adminNotes: user.adminNotes,
    payroll: buildPayrollIdentity(user, extended),
    credentials: resolveCredentialStatuses(user, now),
    documents,
    missingDocuments: requests,
    summary,
    figures,
    performance: perf
      ? {
          onTimePercent: perf.reliability.onTimePercent,
          attendancePercent: perf.attendance.percent,
          avgRating: perf.customerSatisfaction.avgRating,
          reworkPercent: perf.reworkRate.percent,
          documentCompliancePercent: perf.documentCompliance.percent,
        }
      : null,
    isFieldRole,
    vaAccess: user.role === Role.VA
      ? {
          team: user.vaTeam
            ? {
                id: user.vaTeam.id,
                name: user.vaTeam.name,
                isActive: user.vaTeam.isActive,
                clientName: user.vaTeam.client?.name ?? null,
                permissions: (user.vaTeam.permissions ?? {}) as Record<string, boolean>,
              }
            : null,
          scopeProperties: scopeProperties.map((p) => p.name),
        }
      : null,
    testable: user.isActive && TESTABLE_ROLES.includes(user.role),
  };
}
