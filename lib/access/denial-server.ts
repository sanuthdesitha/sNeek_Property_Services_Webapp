import "server-only";
/**
 * Server half of the access-denied pages: reads the live session (the person
 * being tested as, while testing), the live operations policy and company
 * details, and turns them into a page view with `lib/access/denial.ts`.
 *
 * A failed read is NOT a denial: it returns the "unknown" view (Try again),
 * never "You can't open…". Nothing here grants or widens anything; the
 * refusal itself was made by middleware or the page's own guard.
 */
import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getOpsPolicy } from "@/lib/rbac/ops-access";
import { findPreset, isOpsSubject, resolveOpsLevels } from "@/lib/rbac/ops-policy";
import { opsRequestFeature, ownerRouteCapability } from "@/lib/rbac/ops-catalog";
import { capabilityDefinition } from "@/lib/rbac/capabilities";
import {
  denialPagePath,
  denialPortalForRole,
  isOpsFeature,
  nothingDeniedView,
  officeDenialView,
  portalDenialView,
  unknownView,
  type DenialPageView,
  type DenialPortal,
  type OfficeAreaFacts,
  type OfficeDenialReason,
} from "./denial";
import { withFrom } from "./return-path";

type LiveSession = Awaited<ReturnType<typeof requireSession>>;

/** next/navigation's redirect() and notFound() throw; they must pass through. */
function isNavigationSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}

/** The live session, or null when it could not be read (shown as "could not be checked"). */
async function liveSession(): Promise<LiveSession | null> {
  try {
    return await requireSession();
  } catch (error) {
    if (isNavigationSignal(error)) throw error;
    if (error instanceof Error && error.message === "UNAUTHORIZED") redirect("/login");
    return null;
  }
}

/** Active administrators' names (never emails), for office staff only. */
export async function administratorNames(excludeUserId: string): Promise<string[]> {
  const rows = await db.user.findMany({
    where: {
      isActive: true,
      id: { not: excludeUserId },
      OR: [{ role: Role.ADMIN }, { extraRoles: { some: { role: Role.ADMIN } } }],
    },
    select: { name: true, email: true },
    orderBy: { name: "asc" },
    take: 6,
  });
  return rows.map((row) => row.name?.trim() || "An administrator").filter((name, index, all) => all.indexOf(name) === index);
}

/** What the live policy says about the area a path belongs to, for this person. */
export async function officeAreaFacts(userId: string, from: string | null): Promise<OfficeAreaFacts | "not_denied"> {
  if (!from) return { kind: "unknown_page" };
  const feature = opsRequestFeature(from);
  if (feature === "unmapped") return { kind: "unmapped" };
  if (!isOpsFeature(feature)) return { kind: "unknown_page" };
  const policy = await getOpsPolicy();
  const level = resolveOpsLevels(policy, userId)[feature];
  if (level === "manage") return "not_denied";
  const assignment = policy.assignments[userId];
  const preset = assignment ? findPreset(policy, assignment.presetId) : undefined;
  return {
    kind: "area",
    area: feature,
    level,
    presetName: preset?.name ?? null,
    presetAudience: preset?.audience ?? "manager",
    setOnPerson: assignment?.overrides?.[feature] !== undefined,
  };
}

function officeReason(param: string | undefined, from: string | null): OfficeDenialReason {
  if (param === "portal") return "portal";
  if (param === "role") return "role";
  return from && opsRequestFeature(from) === "owner" ? "role" : "feature";
}

/** The office (admin portal) denial page. */
export async function loadOfficeDenial(input: { reason?: string; from: string | null }): Promise<DenialPageView> {
  const session = await liveSession();
  if (!session) return unknownView("admin");
  const held = (session.user.heldRoles ?? [session.user.role]).map(String);
  const impersonating = Boolean(session.impersonation);
  const portal = denialPortalForRole(session.user.role);
  // A worker (or the person being tested as) belongs on their own portal's page.
  if (portal && portal !== "admin" && !held.includes(Role.ADMIN) && !held.includes(Role.OPS_MANAGER)) {
    redirect(withFrom(denialPagePath(portal), input.from));
  }
  const reason = officeReason(input.reason, input.from);
  if (held.includes(Role.ADMIN) && reason !== "portal") return nothingDeniedView();
  try {
    const facts = reason === "feature" && isOpsSubject({ role: String(session.user.role), heldRoles: held })
      ? await officeAreaFacts(session.user.id, input.from)
      : ({ kind: "unknown_page" } as const);
    if (facts === "not_denied") {
      return { ...nothingDeniedView(), title: "Nothing is refused now", message: "Your access includes this area now. Use the menu to open it." };
    }
    const grant = input.from ? ownerRouteCapability(input.from) : null;
    return officeDenialView({
      reason,
      from: input.from,
      viewer: { name: session.user.name ?? "You", isAdministrator: held.includes(Role.ADMIN) },
      facts,
      administrators: await administratorNames(session.user.id),
      grantLabel: grant ? capabilityDefinition(grant).label : null,
      impersonating,
    });
  } catch (error) {
    if (isNavigationSignal(error)) throw error;
    return unknownView("admin");
  }
}

/** A worker or client portal's denial page. */
export async function loadPortalDenial(portal: Exclude<DenialPortal, "admin">, from: string | null): Promise<DenialPageView> {
  const session = await liveSession();
  if (!session) return unknownView(portal);
  const own = denialPortalForRole(session.user.role);
  // Office staff and people of another portal get their own portal's answer.
  if (own && own !== portal) {
    const held = (session.user.heldRoles ?? [session.user.role]).map(String);
    const holdsThisPortal = portal === "client" ? held.includes(Role.CLIENT) || held.includes("VA") : held.includes(PORTAL_ROLE[portal]);
    if (!holdsThisPortal) redirect(own === "admin" ? withFrom("/v2/admin/access-denied?reason=portal", from) : withFrom(denialPagePath(own), from));
  }
  try {
    const [settings, organisation] = await Promise.all([getAppSettings(), clientOrganisation(portal, session.user.id)]);
    return portalDenialView({
      portal,
      from,
      viewer: { name: session.user.name ?? "you", organisation },
      officePhone: settings.companyPhone,
      impersonating: Boolean(session.impersonation),
    });
  } catch (error) {
    if (isNavigationSignal(error)) throw error;
    return unknownView(portal);
  }
}

const PORTAL_ROLE: Record<Exclude<DenialPortal, "admin" | "client">, string> = {
  cleaner: Role.CLEANER,
  laundry: Role.LAUNDRY,
  qa: Role.QA_INSPECTOR,
  maintenance: Role.MAINTENANCE,
};

async function clientOrganisation(portal: DenialPortal, userId: string): Promise<string | null> {
  if (portal !== "client") return null;
  const user = await db.user.findUnique({ where: { id: userId }, select: { client: { select: { name: true } } } });
  return user?.client?.name ?? null;
}
