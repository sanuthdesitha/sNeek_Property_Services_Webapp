import { NextRequest, NextResponse } from "next/server";
import { MaintenanceSource, MaintenancePriority, Prisma } from "@prisma/client";
import { z } from "zod";
import { propertyScopeWhere, requireClientPortal } from "@/lib/auth/client-portal";
import { db } from "@/lib/db";
import { parseVisitPlan } from "@/lib/maintenance/visit-plan";

/**
 * A client or their assistant scheduling a maintenance visit.
 *
 * NO ADMIN APPROVAL. This is the client's own property and their own
 * contractor; making them wait for the office to bless a plumber they have
 * already booked would be theatre, and the office would rubber-stamp it. What
 * the office needs is to KNOW, which it does the moment this is created.
 *
 * The visit is stored as a validated blob on the maintenance item — see
 * lib/maintenance/visit-plan for why, and for the deliberate absence of any
 * cost field. A VA must never commit spend.
 *
 * Property scope runs through the chokepoint's `propertyScopeWhere`, so a VA
 * narrowed to three properties cannot schedule work at a fourth.
 */

const visitSchema = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
  expectedMinutes: z.number().int().min(1).max(24 * 60).optional(),
  contractorName: z.string().trim().max(120).optional(),
  contractorPhone: z.string().trim().max(40).optional(),
  accessMethod: z
    .enum(["CLEANER_LETS_IN", "LOCKBOX", "CLIENT_MEETING", "CONTRACTOR_HAS_KEY"])
    .optional(),
  cleanerPresence: z.enum(["REQUIRED", "NOT_REQUIRED", "WORK_AROUND"]).optional(),
  cleanTiming: z.enum(["BEFORE", "AFTER", "UNAFFECTED"]).optional(),
  areasAffected: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  cleanerInstructions: z.string().trim().max(2000).optional(),
  dayNotes: z.string().trim().max(2000).optional(),
  dayContactName: z.string().trim().max(120).optional(),
  dayContactPhone: z.string().trim().max(40).optional(),
  remindOnDay: z.boolean().optional(),
});

const createSchema = z.object({
  propertyId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).optional(),
  priority: z.nativeEnum(MaintenancePriority).optional(),
  visit: visitSchema,
});

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const portal = await requireClientPortal({ permission: "maintenance" });

    const items = await db.propertyMaintenanceItem.findMany({
      where: {
        property: propertyScopeWhere(portal),
        // Only rows that ARE a scheduled visit. A maintenance item raised
        // from a damage case has no plan and does not belong on this list.
        NOT: { visitPlan: { equals: Prisma.DbNull } },
      },
      orderBy: { scheduledFor: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        scheduledFor: true,
        visitPlan: true,
        property: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({
      // Parsed on the way OUT as well as in: a blob hand-edited in the database,
      // or written by an older shape, must not reach the UI half-formed.
      items: items.map((item) => ({ ...item, visitPlan: parseVisitPlan(item.visitPlan) })),
    });
  } catch (err: any) {
    const status =
      err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: "Could not load scheduled visits." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const portal = await requireClientPortal({ permission: "maintenance" });
    const body = createSchema.parse(await req.json().catch(() => ({})));

    // Ownership AND scope in one query. Checking the client alone would let a
    // narrowed VA schedule work at a property their client owns but they were
    // never granted.
    const property = await db.property.findFirst({
      where: { id: body.propertyId, ...propertyScopeWhere(portal) },
      select: { id: true },
    });
    if (!property) {
      return NextResponse.json({ error: "Property not found." }, { status: 404 });
    }

    const visitPlan = parseVisitPlan(body.visit);
    if (!visitPlan) {
      return NextResponse.json({ error: "A visit needs a start time." }, { status: 400 });
    }

    const item = await db.propertyMaintenanceItem.create({
      data: {
        propertyId: property.id,
        reportedByUserId: portal.userId,
        // CLIENT even when a VA entered it: the assistant acts on the client's
        // behalf, and what the office cares about is whose property raised it.
        // Who actually typed it is preserved on reportedByUserId.
        source: MaintenanceSource.CLIENT,
        title: body.title,
        description: body.description ?? null,
        priority: body.priority ?? MaintenancePriority.MEDIUM,
        scheduledFor: new Date(visitPlan.startAt),
        visitPlan: visitPlan as unknown as object,
      },
      select: { id: true },
    });

    return NextResponse.json({ id: item.id }, { status: 201 });
  } catch (err: any) {
    const status =
      err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: "Could not schedule that visit." }, { status });
  }
}
