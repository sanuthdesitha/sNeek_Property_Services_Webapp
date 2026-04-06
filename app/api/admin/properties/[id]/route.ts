import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { updatePropertySchema } from "@/lib/validations/client";
import { Role } from "@prisma/client";
import { verifySensitiveAction } from "@/lib/security/admin-verification";
import { getValidationErrorMessage } from "@/lib/validations/errors";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";

function buildPropertyAccessInfo(input: Record<string, any>) {
  const accessInfo =
    input.accessInfo && typeof input.accessInfo === "object" && !Array.isArray(input.accessInfo)
      ? { ...(input.accessInfo as Record<string, unknown>) }
      : {};

  const codeValue =
    typeof input.accessCode === "string" && input.accessCode.trim()
      ? input.accessCode.trim()
      : typeof accessInfo.codes === "string"
        ? String(accessInfo.codes).trim()
        : "";
  const keyLocation =
    typeof input.keyLocation === "string" && input.keyLocation.trim()
      ? input.keyLocation.trim()
      : typeof accessInfo.lockbox === "string"
        ? String(accessInfo.lockbox).trim()
        : "";
  const accessNotesParts = [
    typeof input.accessNotes === "string" ? input.accessNotes.trim() : "",
    typeof accessInfo.instructions === "string" ? String(accessInfo.instructions).trim() : "",
    typeof accessInfo.other === "string" ? String(accessInfo.other).trim() : "",
  ].filter(Boolean);

  return {
    ...accessInfo,
    lockbox: keyLocation,
    codes: codeValue,
    instructions:
      typeof accessInfo.instructions === "string" ? String(accessInfo.instructions).trim() : "",
    other: typeof accessInfo.other === "string" ? String(accessInfo.other).trim() : "",
    parking:
      typeof accessInfo.parking === "string" ? String(accessInfo.parking).trim() : "",
    laundryTeamUserIds: Array.isArray((accessInfo as any).laundryTeamUserIds)
      ? (accessInfo as any).laundryTeamUserIds
      : [],
    attachments: Array.isArray((accessInfo as any).attachments)
      ? (accessInfo as any).attachments
      : [],
    accessNotesSummary: accessNotesParts.join("\n\n"),
  };
}

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
    return NextResponse.json({
      ...property,
      accessCode: decryptSecret(property.accessCode),
      alarmCode: decryptSecret(property.alarmCode),
    });
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
    const normalizedAccessInfo = buildPropertyAccessInfo(body as Record<string, any>);
    const property = await db.property.update({
      where: { id: params.id },
      data: {
        ...body,
        latitude: body.latitude ?? undefined,
        longitude: body.longitude ?? undefined,
        accessCode:
          body.accessCode !== undefined
            ? encryptSecret(body.accessCode ?? "")
            : undefined,
        alarmCode:
          body.alarmCode !== undefined
            ? encryptSecret(body.alarmCode ?? "")
            : undefined,
        keyLocation:
          body.keyLocation !== undefined
            ? body.keyLocation?.trim() || normalizedAccessInfo.lockbox || null
            : undefined,
        accessNotes:
          body.accessNotes !== undefined
            ? body.accessNotes?.trim() || normalizedAccessInfo.accessNotesSummary || null
            : undefined,
        accessInfo: body.accessInfo !== undefined ? (normalizedAccessInfo as any) : undefined,
        preferredCleanerUserId: body.preferredCleanerUserId ?? undefined,
      },
    });
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
