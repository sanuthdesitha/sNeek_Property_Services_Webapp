import { NextRequest, NextResponse } from "next/server";
import { LaundryStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const createSchema = z.object({
  propertyId: z.string().cuid(),
  jobId: z.string().cuid(),
  pickupDate: z.string().datetime(),
  dropoffDate: z.string().datetime(),
  status: z.nativeEnum(LaundryStatus).default("PENDING"),
  flagNotes: z.string().trim().optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json());

    const property = await db.property.findUnique({
      where: { id: body.propertyId },
      select: { id: true, name: true, suburb: true, clientId: true },
    });
    if (!property) {
      return NextResponse.json({ error: "Property not found." }, { status: 404 });
    }

    const task = await db.laundryTask.create({
      data: {
        propertyId: body.propertyId,
        jobId: body.jobId,
        pickupDate: new Date(body.pickupDate),
        dropoffDate: new Date(body.dropoffDate),
        status: body.status,
        flagNotes: body.flagNotes || undefined,
      },
      include: {
        property: { select: { id: true, name: true, suburb: true } },
      },
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: task.jobId,
        action: "CREATE_LAUNDRY_TASK",
        entity: "LaundryTask",
        entityId: task.id,
        after: {
          propertyId: task.propertyId,
          jobId: task.jobId,
          pickupDate: task.pickupDate?.toISOString(),
          dropoffDate: task.dropoffDate?.toISOString(),
          status: task.status,
          source: "MANUAL",
        },
      },
    });

    return NextResponse.json(task, { status: 201 });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not create laundry task." }, { status });
  }
}
