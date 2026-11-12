import { db } from "@/lib/db";
import type { LostFoundItem, LostFoundEvent } from "@prisma/client";
import { bookingSummary, type BookingRecord, type BookingSummary } from "./guest";
import { lostFoundPhotoSrc } from "./photo-src";

/**
 * Lost & Found keeps scalar refs to Property / User / Job (only the booking is
 * a relation). These helpers batch-fetch the display data in one query per
 * entity type and shape the API payloads the office and cleaner screens use.
 * New fields are additive: every field the old board read is unchanged.
 */

/**
 * `url` is the link stored when the photo was saved (public bucket link);
 * `src` is where screens show it from: the item's photo route, which signs a
 * fresh link for whoever may open the item (./photo-src.ts). `src` is added
 * when an item is serialized; parsePhotos alone does not know the item.
 */
export type LostFoundPhoto = { url: string; key: string; caption?: string | null; src?: string };

export function parsePhotos(value: unknown): LostFoundPhoto[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p) => ({
      url: String(p.url ?? ""),
      key: String(p.key ?? ""),
      caption: p.caption != null ? String(p.caption) : null,
    }))
    .filter((p) => p.url && p.key);
}

function uniq(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v)));
}

type PropertyInfo = { name: string; suburb: string | null; clientId: string; address: string; state: string; postcode: string | null };

type NameMaps = {
  properties: Map<string, PropertyInfo>;
  clients: Map<string, { name: string }>;
  users: Map<string, { name: string | null; email: string }>;
  jobs: Map<string, { jobNumber: string | null; scheduledDate: Date; reservationId: string | null }>;
  bookings: Map<string, BookingRecord>;
};

type ItemRefs = Pick<LostFoundItem, "propertyId" | "jobId" | "reportedByUserId" | "resolvedByUserId" | "reservationId">;

const BOOKING_SELECT = {
  id: true, guestName: true, guestPhone: true, guestEmail: true, reservationCode: true, source: true,
  startDate: true, endDate: true, adults: true, children: true, infants: true,
} as const;

async function buildNameMaps(items: ItemRefs[], eventUserIds: (string | null | undefined)[] = []): Promise<NameMaps> {
  const propertyIds = uniq(items.map((i) => i.propertyId));
  const jobIds = uniq(items.map((i) => i.jobId));
  const bookingIds = uniq(items.map((i) => i.reservationId));
  const userIds = uniq([...items.map((i) => i.reportedByUserId), ...items.map((i) => i.resolvedByUserId), ...eventUserIds]);

  const [properties, jobs, users, bookings] = await Promise.all([
    propertyIds.length
      ? db.property.findMany({ where: { id: { in: propertyIds } }, select: { id: true, name: true, suburb: true, clientId: true, address: true, state: true, postcode: true } })
      : Promise.resolve([]),
    jobIds.length
      ? db.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, jobNumber: true, scheduledDate: true, reservationId: true } })
      : Promise.resolve([]),
    userIds.length
      ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
    bookingIds.length ? db.reservation.findMany({ where: { id: { in: bookingIds } }, select: BOOKING_SELECT }) : Promise.resolve([]),
  ]);
  const clientIds = uniq(properties.map((p) => p.clientId));
  const clients = clientIds.length ? await db.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } }) : [];

  return {
    properties: new Map(properties.map((p) => [p.id, p])),
    clients: new Map(clients.map((c) => [c.id, { name: c.name }])),
    users: new Map(users.map((u) => [u.id, { name: u.name, email: u.email }])),
    jobs: new Map(jobs.map((j) => [j.id, { jobNumber: j.jobNumber ?? null, scheduledDate: j.scheduledDate, reservationId: j.reservationId }])),
    bookings: new Map(bookings.map((b) => [b.id, b])),
  };
}

function userLabel(maps: NameMaps, id: string | null): string | null {
  if (!id) return null;
  const u = maps.users.get(id);
  if (!u) return null;
  return u.name?.trim() || u.email;
}

function addressLine(property: PropertyInfo | null | undefined): string | null {
  if (!property) return null;
  return [property.address, property.suburb, [property.state, property.postcode].filter(Boolean).join(" ")].filter((part) => part && part.trim()).join(", ");
}

export function serializeItemRow(item: LostFoundItem, maps: NameMaps) {
  const property = item.propertyId ? maps.properties.get(item.propertyId) : null;
  const job = item.jobId ? maps.jobs.get(item.jobId) : null;
  const booking = item.reservationId ? maps.bookings.get(item.reservationId) : null;
  const client = property ? maps.clients.get(property.clientId) : null;
  return {
    id: item.id,
    itemName: item.itemName,
    description: item.description,
    foundLocation: item.foundLocation,
    photos: parsePhotos(item.photos).map((photo) => ({ ...photo, src: lostFoundPhotoSrc(item.id, photo.key) })),
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
    // Added with the redesign (office data; redacted for the reporting cleaner).
    guestEmail: item.guestEmail,
    guestSource: item.guestSource,
    reservationId: item.reservationId,
    booking: booking ? bookingSummary(booking) : (null as BookingSummary | null),
    /** True/false when a job is linked; null when the item has no job. */
    jobHasBooking: job ? Boolean(job.reservationId) : (null as boolean | null),
    storageLocation: item.storageLocation,
    clientName: client?.name ?? null,
    propertyAddress: addressLine(property),
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

export type HydratedLostFoundItem = Awaited<ReturnType<typeof hydrateItemWithEvents>>;

/**
 * Guest details, valuation, booking, client and storage are office working
 * data, not the finder's. The reporting cleaner gets none of them.
 */
export function redactItemForReporter<T extends LostFoundItemRow>(row: T): T {
  return {
    ...row,
    guestName: null,
    guestContact: null,
    estimatedValue: null,
    guestEmail: null,
    guestSource: null,
    reservationId: null,
    booking: null,
    jobHasBooking: null,
    storageLocation: null,
    clientName: null,
    propertyAddress: null,
  };
}

/**
 * The reporting cleaner keeps the conversation (comments) and their own
 * entries. Office workflow entries stay on the timeline as a status line, but
 * without the office's note or metadata, which can carry guest contact.
 */
export function redactItemWithEventsForReporter(detail: HydratedLostFoundItem, events: LostFoundEvent[], reporterId: string) {
  const authorById = new Map(events.map((event) => [event.id, event.userId]));
  return {
    ...redactItemForReporter(detail),
    events: detail.events.map((event) => {
      const own = authorById.get(event.id) === reporterId;
      if (own || event.action === "COMMENT") return event;
      return { ...event, note: null, meta: null };
    }),
  };
}
