import { NextRequest, NextResponse } from "next/server";
import { Role, type Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { publicUrl } from "@/lib/s3";
import { findForeignUploadKeys } from "@/lib/uploads/ownership-server";
import { FOREIGN_UPLOAD_CODE, FOREIGN_UPLOAD_MESSAGE } from "@/lib/uploads/ownership";
import { isListQueryError, parseListQuery } from "@/lib/admin/list-query";
import { logger } from "@/lib/logger";
import { createLostFoundItem } from "@/lib/lost-found/create";
import { listLostFoundForOffice, LOST_FOUND_SORTS, parseLostFoundFilters } from "@/lib/lost-found/list";
import { hydrateItems } from "@/lib/lost-found/service";
import { LOST_FOUND_STATUSES } from "@/lib/lost-found/status";

function errorStatus(err: any): number {
  if (err?.message === "UNAUTHORIZED") return 401;
  if (err?.message === "FORBIDDEN") return 403;
  return 400;
}

/**
 * GET — admin/ops list of lost & found items.
 *  - `paginated=1`: the office table (stage tabs, filters, server paging and
 *    sorting) → listResponse + { counts, summary, holdingDays, properties }.
 *  - otherwise the original board query, unchanged:
 *    status, propertyId, from (ISO), to (ISO), q → { items, openCount, properties }.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    if (searchParams.get("paginated") === "1") {
      const query = parseListQuery(searchParams, { sortable: LOST_FOUND_SORTS, defaultSort: "found", defaultDir: "asc", defaultPageSize: 25, maxPageSize: 100 });
      return NextResponse.json(await listLostFoundForOffice(parseLostFoundFilters(searchParams), query));
    }

    const status = searchParams.get("status")?.trim();
    const propertyId = searchParams.get("propertyId")?.trim();
    const from = searchParams.get("from")?.trim();
    const to = searchParams.get("to")?.trim();
    const q = searchParams.get("q")?.trim();

    const where: Prisma.LostFoundItemWhereInput = {};
    if (status && (LOST_FOUND_STATUSES as readonly string[]).includes(status)) {
      where.status = status as any;
    }
    if (propertyId) where.propertyId = propertyId;

    const createdAt: Prisma.DateTimeFilter = {};
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) createdAt.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        createdAt.lte = d;
      }
    }
    if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

    if (q) {
      where.OR = [
        { itemName: { contains: q } },
        { foundLocation: { contains: q } },
        { guestName: { contains: q } },
        { description: { contains: q } },
      ];
    }

    const items = await db.lostFoundItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    const rows = await hydrateItems(items);
    // Stable open badge: total unresolved items, independent of the active filter.
    const openCount = await db.lostFoundItem.count({
      where: { status: { notIn: ["RETURNED", "DISPOSED", "DONATED", "UNCLAIMED", "ARCHIVED"] as any } },
    });

    // Property options for the filter — only those that have items.
    const propertyMap = new Map<string, string>();
    for (const r of rows) {
      if (r.propertyId && r.propertyName) propertyMap.set(r.propertyId, r.propertyName);
    }
    const properties = Array.from(propertyMap, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return NextResponse.json({ items: rows, openCount, properties });
  } catch (err: any) {
    if (isListQueryError(err)) return NextResponse.json({ error: err.message }, { status: 400 });
    return NextResponse.json({ error: err.message }, { status: errorStatus(err) });
  }
}

const photoSchema = z.object({
  url: z.string().trim().min(1),
  key: z.string().trim().min(1),
  caption: z.string().trim().max(300).optional().nullable(),
});

const createSchema = z.object({
  propertyId: z.string().trim().min(1, "Choose the property."),
  jobId: z.string().trim().min(1).optional().nullable(),
  itemName: z.string().trim().min(1, "Name the item.").max(180),
  location: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(6000).optional().nullable(),
  photos: z.array(photoSchema).max(20).optional().default([]),
}).strict();

/**
 * POST — the office logs a found item (ADMIN / OPS_MANAGER, like every other
 * admin lost-and-found route). Property required; a job is optional and must
 * be at that property. With a job, its departing booking's guest is copied.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json());
    const property = await db.property.findUnique({ where: { id: body.propertyId }, select: { id: true } });
    if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });
    const jobId = body.jobId?.trim() || null;
    if (jobId) {
      const job = await db.job.findUnique({ where: { id: jobId }, select: { propertyId: true } });
      if (!job || job.propertyId !== property.id) return NextResponse.json({ error: "The job is not at this property." }, { status: 400 });
    }
    const foreignKeys = await findForeignUploadKeys({ keys: body.photos.map((photo) => photo.key), callerId: session.user.id, jobId: jobId ?? undefined });
    if (foreignKeys.length > 0) return NextResponse.json({ code: FOREIGN_UPLOAD_CODE, error: FOREIGN_UPLOAD_MESSAGE }, { status: 403 });
    const item = await createLostFoundItem({
      actorId: session.user.id,
      propertyId: property.id,
      jobId,
      itemName: body.itemName,
      location: body.location?.trim() || null,
      notes: body.notes?.trim() || null,
      // The link is derived from the verified key, never taken from the browser.
      photos: body.photos.map((photo) => ({ key: photo.key, url: publicUrl(photo.key), caption: photo.caption ?? null })),
      loggedBy: "OFFICE",
    });
    logger.info({ itemId: item.id, propertyId: property.id, jobId, loggedBy: session.user.id }, "lost-found item logged by office");
    return NextResponse.json({ ok: true, itemId: item.id });
  } catch (err: any) {
    if (err instanceof ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    return NextResponse.json({ error: err.message }, { status: errorStatus(err) });
  }
}
