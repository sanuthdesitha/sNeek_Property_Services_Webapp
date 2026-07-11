import { db } from "@/lib/db";
import type { LostFoundItem, LostFoundEvent } from "@prisma/client";

/**
 * Lost & Found uses scalar refs (no Prisma relations) to Property / User / Job.
 * These helpers batch-fetch the display names in one query per entity type and
 * shape the API payloads the Estate / v1 UIs consume.
 */

export type LostFoundPhoto = { url: string; key: string; caption?: string | null };

export function parsePhotos(value: unknown): LostFoundPhoto[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p) => ({
      url: String((p as any).url ?? ""),
      key: String((p as any).key ?? ""),
      caption: (p as any).caption != null ? String((p as any).caption) : null,
    }))
    .filter((p) => p.url && p.key);
}

function uniq(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v)));
}

type NameMaps = {
  properties: Map<string, { name: string; suburb: string | null }>;
  users: Map<string, { name: string | null; email: string }>;
  jobs: Map<string, { jobNumber: string | null; scheduledDate: Date }>;
};

async function buildNameMaps(
  items: Pick<LostFoundItem, "propertyId" | "jobId" | "reportedByUserId" | "resolvedByUserId">[],
  eventUserIds: (string | null | undefined)[] = []
): Promise<NameMaps> {
  const propertyIds = uniq(items.map((i) => i.propertyId));
  const jobIds = uniq(items.map((i) => i.jobId));
  const userIds = uniq([
    ...items.map((i) => i.reportedByUserId),
    ...items.map((i) => i.resolvedByUserId),
    ...eventUserIds,
  ]);

  const [properties, jobs, users] = await Promise.all([
    propertyIds.length
      ? db.property.findMany({ where: { id: { in: propertyIds } }, select: { id: true, name: true, suburb: true } })
      : Promise.resolve([]),
    jobIds.length
      ? db.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, jobNumber: true, scheduledDate: true } })
      : Promise.resolve([]),
    userIds.length
      ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
  ]);

  return {
    properties: new Map(properties.map((p) => [p.id, { name: p.name, suburb: p.suburb }])),
    users: new Map(users.map((u) => [u.id, { name: u.name, email: u.email }])),
    jobs: new Map(jobs.map((j) => [j.id, { jobNumber: j.jobNumber ?? null, scheduledDate: j.scheduledDate }])),
  };
}

function userLabel(maps: NameMaps, id: string | null): string | null {
  if (!id) return null;
  const u = maps.users.get(id);
  if (!u) return null;
  return u.name?.trim() || u.email;
}

export function serializeItemRow(item: LostFoundItem, maps: NameMaps) {
  const property = item.propertyId ? maps.properties.get(item.propertyId) : null;
  const job = item.jobId ? maps.jobs.get(item.jobId) : null;
  return {
    id: item.id,
    itemName: item.itemName,
    description: item.description,
    foundLocation: item.foundLocation,
    photos: parsePhotos(item.photos),
    status: item.status,
    guestName: item.guestName,
    guestContact: item.guestContact,
    estimatedValue: item.estimatedValue,
    resolution: item.resolution,
    resolvedAt: item.resolvedAt ? item.resolvedAt.toISOString() : null,
    resolvedByName: userLabel(maps, item.resolvedByUserId),
    reportedByName: userLabel(maps, item.reportedByUserId),
    reportedByUserId: item.reportedByUserId,
    propertyId: item.propertyId,
    propertyName: property ? (property.suburb ? `${property.name} (${property.suburb})` : property.name) : null,
    jobId: item.jobId,
    jobNumber: job?.jobNumber ?? null,
    jobDate: job?.scheduledDate ? job.scheduledDate.toISOString() : null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export type LostFoundItemRow = ReturnType<typeof serializeItemRow>;

/** Batch-hydrate a list of items with property / job / reporter names. */
export async function hydrateItems(items: LostFoundItem[]): Promise<LostFoundItemRow[]> {
  const maps = await buildNameMaps(items);
  return items.map((item) => serializeItemRow(item, maps));
}

/** Hydrate one item plus its full timeline (with per-event actor names). */
export async function hydrateItemWithEvents(item: LostFoundItem, events: LostFoundEvent[]) {
  const maps = await buildNameMaps([item], events.map((e) => e.userId));
  return {
    ...serializeItemRow(item, maps),
    events: events.map((e) => ({
      id: e.id,
      action: e.action,
      note: e.note,
      meta: e.meta,
      actorName: userLabel(maps, e.userId),
      createdAt: e.createdAt.toISOString(),
    })),
  };
}
