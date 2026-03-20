import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getUserExtendedProfile, upsertUserExtendedProfile } from "@/lib/accounts/user-details";

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().nullable().optional(),
  role: z.nativeEnum(Role).optional(),
  isActive: z.boolean().optional(),
  clientId: z.string().trim().nullable().optional(),
  businessName: z.string().trim().max(200).optional().nullable(),
  abn: z.string().trim().max(32).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  contactNumber: z.string().trim().max(32).optional().nullable(),
  bankDetails: z
    .object({
      accountName: z.string().trim().max(160).optional(),
      bankName: z.string().trim().max(160).optional(),
      bsb: z.string().trim().max(16).optional(),
      accountNumber: z.string().trim().max(32).optional(),
    })
    .nullable()
    .optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = updateSchema.parse(await req.json());

    const existing = await db.user.findUnique({
      where: { id: params.id },
      select: { id: true, email: true, role: true, isActive: true, clientId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }
    const existingExtended = await getUserExtendedProfile(existing.id);

    if (existing.id === session.user.id) {
      if (body.role && body.role !== Role.ADMIN) {
        return NextResponse.json({ error: "You cannot demote your own admin account." }, { status: 400 });
      }
      if (body.isActive === false) {
        return NextResponse.json({ error: "You cannot disable your own account." }, { status: 400 });
      }
    }

    const nextEmail = body.email?.toLowerCase();
    if (nextEmail && nextEmail !== existing.email.toLowerCase()) {
      const conflict = await db.user.findUnique({ where: { email: nextEmail }, select: { id: true } });
      if (conflict && conflict.id !== existing.id) {
        return NextResponse.json({ error: "Email is already in use." }, { status: 409 });
      }
    }

    let nextClientId: string | null | undefined = existing.clientId;
    if (body.role && body.role !== Role.CLIENT) {
      nextClientId = null;
    }
    if (body.role === Role.CLIENT || (body.role === undefined && existing.role === Role.CLIENT)) {
      if (body.clientId !== undefined) {
        if (body.clientId === null || body.clientId === "") {
          return NextResponse.json({ error: "Client accounts must be linked to a client profile." }, { status: 400 });
        }
        const client = await db.client.findUnique({
          where: { id: body.clientId },
          select: { id: true, isActive: true },
        });
        if (!client || !client.isActive) {
          return NextResponse.json({ error: "Selected client does not exist or is inactive." }, { status: 400 });
        }
        nextClientId = client.id;
      }
      if (!nextClientId) {
        return NextResponse.json({ error: "Client accounts must be linked to a client profile." }, { status: 400 });
      }
    }

    const targetRole = body.role ?? existing.role;
    const nextBusinessName =
      body.businessName !== undefined ? body.businessName?.trim() || null : existingExtended?.businessName ?? null;
    const nextAbn = body.abn !== undefined ? body.abn?.trim() || null : existingExtended?.abn ?? null;
    const nextAddress =
      body.address !== undefined ? body.address?.trim() || null : existingExtended?.address ?? null;
    const nextContactNumber =
      body.contactNumber !== undefined
        ? body.contactNumber?.trim() || null
        : existingExtended?.contactNumber ?? null;
    const nextBankDetails =
      body.bankDetails !== undefined
        ? body.bankDetails
          ? {
              accountName: body.bankDetails.accountName?.trim() ?? "",
              bankName: body.bankDetails.bankName?.trim() ?? "",
              bsb: body.bankDetails.bsb?.trim() ?? "",
              accountNumber: body.bankDetails.accountNumber?.trim() ?? "",
            }
          : null
        : existingExtended?.bankDetails ?? null;

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (nextEmail !== undefined) data.email = nextEmail;
    if (body.phone !== undefined) data.phone = body.phone?.trim() || null;
    if (body.role !== undefined) data.role = body.role;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (nextClientId !== undefined) data.clientId = nextClientId;

    const updated = await db.$transaction(async (tx) => {
      const nextUser = await tx.user.update({
        where: { id: params.id },
        data,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          phone: true,
          isActive: true,
          emailVerified: true,
          clientId: true,
          client: { select: { id: true, name: true } },
        },
      });

      if (body.isActive === false) {
        await tx.session.deleteMany({ where: { userId: params.id } });
      }

      return nextUser;
    });

    await upsertUserExtendedProfile(updated.id, {
      businessName: nextBusinessName,
      abn: nextAbn,
      address: nextAddress,
      contactNumber: nextContactNumber,
      bankDetails: nextBankDetails,
    });

    const extendedProfile = await getUserExtendedProfile(updated.id);

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "UPDATE_USER_ACCOUNT",
        entity: "User",
        entityId: updated.id,
        before: existing as any,
        after: data as any,
      },
    });

    return NextResponse.json({ ...updated, extendedProfile });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Update failed." }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    if (params.id === session.user.id) {
      return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
    }

    const existing = await db.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        _count: {
          select: {
            jobAssignments: true,
            timeLogs: true,
            formSubmissions: true,
            auditLogs: true,
            payAdjustmentRequests: true,
            payAdjustmentReviews: true,
          },
        },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const protectedCount =
      existing._count.jobAssignments +
      existing._count.timeLogs +
      existing._count.formSubmissions +
      existing._count.auditLogs +
      existing._count.payAdjustmentRequests +
      existing._count.payAdjustmentReviews;

    if (protectedCount > 0) {
      return NextResponse.json(
        { error: "This user has activity history. Disable the account instead of deleting it." },
        { status: 409 }
      );
    }

    await db.$transaction(async (tx) => {
      await tx.notification.deleteMany({ where: { userId: params.id } });
      await tx.session.deleteMany({ where: { userId: params.id } });
      await tx.account.deleteMany({ where: { userId: params.id } });
      await tx.user.delete({ where: { id: params.id } });
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DELETE_USER_ACCOUNT",
        entity: "User",
        entityId: params.id,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Delete failed." }, { status });
  }
}
