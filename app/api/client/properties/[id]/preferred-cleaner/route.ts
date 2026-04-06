import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";

const schema = z.object({
  preferredCleanerUserId: z.string().cuid().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const settings = await getAppSettings();
    const portal = await getClientPortalContext(session.user.id, settings);
    if (!portal.clientId) {
      return NextResponse.json({ error: "Client profile missing." }, { status: 400 });
    }

    const body = schema.parse(await req.json().catch(() => ({})));
    const property = await db.property.findFirst({
      where: {
        id: params.id,
        clientId: portal.clientId,
        isActive: true,
      },
      select: {
        id: true,
      },
    });
    if (!property) {
      return NextResponse.json({ error: "Property not found." }, { status: 404 });
    }

    if (body.preferredCleanerUserId) {
      const eligible = await db.user.findFirst({
        where: {
          id: body.preferredCleanerUserId,
          role: Role.CLEANER,
          isActive: true,
          jobAssignments: {
            some: {
              removedAt: null,
              job: {
                propertyId: property.id,
              },
            },
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
      });
      if (!eligible) {
        return NextResponse.json(
          { error: "Selected cleaner has not worked at this property yet." },
          { status: 400 }
        );
      }

      await db.property.update({
        where: { id: property.id },
        data: { preferredCleanerUserId: eligible.id },
      });
      return NextResponse.json({
        ok: true,
        preferredCleanerUserId: eligible.id,
        preferredCleanerName: eligible.name || eligible.email,
      });
    }

    await db.property.update({
      where: { id: property.id },
      data: { preferredCleanerUserId: null },
    });

    return NextResponse.json({
      ok: true,
      preferredCleanerUserId: null,
      preferredCleanerName: null,
    });
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(
      { error: error?.message ?? "Could not update preferred cleaner." },
      { status }
    );
  }
}
