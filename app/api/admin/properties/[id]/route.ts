import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { updatePropertySchema } from "@/lib/validations/client";
import { Role } from "@prisma/client";
import { verifySensitiveAction } from "@/lib/security/admin-verification";
import { getValidationErrorMessage } from "@/lib/validations/errors";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const property = await db.property.findUnique({
      where: { id: params.id },
      include: {
        client: true,
        integration: {
          include: {
            syncRuns: {
              orderBy: { createdAt: "desc" },
              take: 10,
              include: {
                triggeredBy: { select: { id: true, name: true, email: true } },
                revertedBy: { select: { id: true, name: true, email: true } },
              },
            },
          },
        },
        propertyStock: { include: { item: true } },
        _count: { select: { jobs: true, reservations: true } },
      },
    });
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(property);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = updatePropertySchema.parse(await req.json());
    const property = await db.property.update({ where: { id: params.id }, data: body });
    return NextResponse.json(property);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: getValidationErrorMessage(err, "Could not update property.") }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    await verifySensitiveAction(session.user.id, body?.security);
    await db.property.update({ where: { id: params.id }, data: { isActive: false } });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DEACTIVATE_PROPERTY",
        entity: "Property",
        entityId: params.id,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED"
        ? 401
        : err.message === "FORBIDDEN"
          ? 403
          : err.message === "INVALID_SECURITY_VERIFICATION" || err.message === "PIN_OR_PASSWORD_REQUIRED"
            ? 423
            : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
