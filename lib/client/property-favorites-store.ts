import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { requireClientPortal, propertyScopeWhere, type ClientPortalContext } from "@/lib/auth/client-portal";
import { DEFAULT_SETTINGS, getAppSettings } from "@/lib/settings";
import { isClientModuleEnabled } from "@/lib/portal-access";
import { emptyPropertyFavorites, propertyFavoriteMutation, propertyFavoritesSchema } from "./property-favorites";

export class PropertyFavoritesError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function requirePropertyFavoritesContext() {
  const settings = await getAppSettings();
  if (settings === DEFAULT_SETTINGS && await db.appSetting.findUnique({ where: { key: "app" }, select: { key: true } })) {
    throw new PropertyFavoritesError(503, "Property preferences are unavailable.");
  }
  const portal = await requireClientPortal({ permission: "properties", settings });
  if (!isClientModuleEnabled(portal.visibility, "properties")) throw new PropertyFavoritesError(403, "Properties are unavailable for this login.");
  const session = await requireSession();
  if (session.user.id !== portal.userId) throw new PropertyFavoritesError(403, "Account context changed. Reload this page.");
  const context = createHash("sha256").update(JSON.stringify([
    "property-favorites-v1", portal.userId, portal.clientId, portal.actor, portal.team?.id ?? null,
    portal.propertyIds ? [...portal.propertyIds].sort() : null,
    session.impersonation?.actorId ?? null, session.impersonation?.mode ?? null, session.impersonation?.startedAt ?? null,
  ])).digest("hex");
  return { portal, context, readOnly: Boolean(session.impersonation) };
}
export const propertyFavoritesKey = (portal: Pick<ClientPortalContext, "userId" | "clientId" | "team">) =>
  `client_property_favorites_v1:${encodeURIComponent(portal.userId)}:${encodeURIComponent(portal.clientId)}:${encodeURIComponent(portal.team?.id ?? "client")}`;

function decode(value: unknown) {
  const parsed = propertyFavoritesSchema.safeParse(value);
  if (!parsed.success) throw new PropertyFavoritesError(503, "Saved property preferences could not be read. They have been preserved.");
  return parsed.data;
}
export async function readPropertyFavorites(portal: ClientPortalContext) {
  const [row, properties] = await Promise.all([
    db.appSetting.findUnique({ where: { key: propertyFavoritesKey(portal) } }),
    db.property.findMany({ where: { ...propertyScopeWhere(portal), isActive: true }, select: { id: true } }),
  ]);
  const state = row ? decode(row.value) : emptyPropertyFavorites();
  const allowed = new Set(properties.map(property => property.id));
  return { ...state, ids: state.ids.filter(id => allowed.has(id)) };
}
export async function changePropertyFavorites(portal: ClientPortalContext, input: unknown) {
  const parsed = propertyFavoriteMutation.safeParse(input);
  if (!parsed.success) throw new PropertyFavoritesError(400, "Invalid property preference change.");
  const mutation = parsed.data;
  return db.$transaction(async tx => {
    const key = propertyFavoritesKey(portal);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const row = await tx.appSetting.findUnique({ where: { key } });
    const current = row ? decode(row.value) : emptyPropertyFavorites();
    if (current.revision !== mutation.revision) throw new PropertyFavoritesError(409, "Property preferences changed elsewhere. Reload preferences before retrying.");
    const properties = await tx.property.findMany({ where: { ...propertyScopeWhere(portal), isActive: true }, select: { id: true } });
    const allowed = new Set(properties.map(property => property.id));
    if ("propertyId" in mutation && !allowed.has(mutation.propertyId)) throw new PropertyFavoritesError(404, "Property is unavailable.");
    const ids = mutation.action === "clear" ? [] : mutation.action === "pin" ? Array.from(new Set([...current.ids, mutation.propertyId])) :
      mutation.action === "unpin" ? current.ids.filter(id => id !== mutation.propertyId) : current.ids;
    if (ids.length > 200) throw new PropertyFavoritesError(409, "You have reached 200 favorites. Unpin properties or clear favorites first.");
    const next = { ...current, ids, revision: current.revision + 1, view: mutation.action === "view" ? mutation.view : current.view };
    await tx.appSetting.upsert({ where: { key }, create: { key, value: next }, update: { value: next } });
    return { ...next, ids: next.ids.filter(id => allowed.has(id)) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 });
}
