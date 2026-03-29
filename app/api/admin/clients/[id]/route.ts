import { NextRequest, NextResponse } from "next/server";
import { Prisma, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { updateClientSchema } from "@/lib/validations/client";
import { verifySensitiveAction } from "@/lib/security/admin-verification";
import { getValidationErrorMessage } from "@/lib/validations/errors";
import {
  normalizeClientEmail,
  syncPrimaryClientUserFromClient,
} from "@/lib/clients/contact-sync";

function normalizePortalVisibilityOverrides(
  input: Record<string, unknown> | null | undefined
): Prisma.InputJsonValue | null {
  if (!input || typeof input !== "object") return null;
  const entries = Object.entries(input).filter(([, value]) => typeof value === "boolean");
  if (!entries.length) return null;
  return Object.fromEntries(entries) as Prisma.InputJsonValue;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const client = await db.client.findUnique({
      where: { id: params.id },
      include: {
        properties: { orderBy: { name: "asc" } },
        users: { select: { id: true, name: true, email: true } },
      },
    });
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(client);
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
    const body = updateClientSchema.parse(await req.json());
    const client = await db.$transaction(async (tx) => {
      const existing = await tx.client.findUnique({
        where: { id: params.id },
        select: { id: true, name: true, email: true, phone: true },
      });
      if (!existing) {
        throw new Error("NOT_FOUND");
      }

      const data = {
        ...body,
        email:
          body.email !== undefined ? normalizeClientEmail(body.email) : body.email,
        portalVisibilityOverrides:
          body.portalVisibilityOverrides !== undefined
            ? normalizePortalVisibilityOverrides(body.portalVisibilityOverrides as Record<string, unknown>) ??
              Prisma.JsonNull
            : body.portalVisibilityOverrides,
      };

      const nextClient = await tx.client.update({ where: { id: params.id }, data });
      await syncPrimaryClientUserFromClient(tx, {
        clientId: nextClient.id,
        name: data.name ?? existing.name,
        email: data.email !== undefined ? data.email : existing.email,
        phone: data.phone !== undefined ? data.phone : existing.phone,
      });
      return nextClient;
    });
    return NextResponse.json(client);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED"
        ? 401
        : err.message === "FORBIDDEN"
          ? 403
          : err.message === "NOT_FOUND"
            ? 404
            : err.message === "CLIENT_CONTACT_EMAIL_IN_USE"
              ? 409
              : 400;
    return NextResponse.json({ error: getValidationErrorMessage(err, "Could not update client.") }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    await verifySensitiveAction(session.user.id, body?.security);
    await db.client.update({ where: { id: params.id }, data: { isActive: false } });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DEACTIVATE_CLIENT",
        entity: "Client",
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
