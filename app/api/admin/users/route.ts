import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createUserByAdminSchema } from "@/lib/validations/user";
import { getAppSettings, setProfileOverrideForUser } from "@/lib/settings";
import { z } from "zod";
import { getUserExtendedProfiles, upsertUserExtendedProfile } from "@/lib/accounts/user-details";
import { upsertAuthUserState } from "@/lib/auth/account-state";

const overrideSchema = z.object({
  userId: z.string().cuid(),
  profileEditOverride: z
    .object({
      canEditName: z.boolean(),
      canEditPhone: z.boolean(),
      canEditEmail: z.boolean(),
    })
    .nullable(),
});

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const role = searchParams.get("role") as Role | null;
    const includeInactive = searchParams.get("includeInactive") === "1";

    const settings = await getAppSettings();

    const users = await db.user.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(role ? { role: role as Role } : {}),
      },
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
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });

    const extendedProfiles = await getUserExtendedProfiles(users.map((user) => user.id));

    return NextResponse.json(
      users.map((user) => ({
        ...user,
        profileEditOverride: settings.profileEditOverrides[user.id] ?? null,
        extendedProfile: extendedProfiles.get(user.id) ?? null,
      }))
    );
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);
    const body = overrideSchema.parse(await req.json());
    const user = await db.user.findUnique({ where: { id: body.userId }, select: { id: true } });
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    await setProfileOverrideForUser(body.userId, body.profileEditOverride);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const payload = createUserByAdminSchema.parse(await req.json());
    const email = payload.email.toLowerCase();

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "Email is already registered." }, { status: 409 });
    }

    let clientId: string | undefined;
    if (payload.role === "CLIENT") {
      if (payload.clientId) {
        const client = await db.client.findUnique({
          where: { id: payload.clientId },
          select: { id: true, isActive: true },
        });
        if (!client || !client.isActive) {
          return NextResponse.json({ error: "Selected client does not exist or is inactive." }, { status: 400 });
        }
        clientId = client.id;
      } else {
        const createdClient = await db.client.create({
          data: {
            name: payload.clientName ?? payload.name,
            email,
            phone: payload.contactNumber || payload.phone || undefined,
            address: payload.address || payload.clientAddress || undefined,
            notes: payload.clientNotes || undefined,
          },
        });
        clientId = createdClient.id;
      }
    }

    const passwordHash = await bcrypt.hash(payload.password, 10);

    const created = await db.user.create({
      data: {
        name: payload.name,
        email,
        passwordHash,
        role: payload.role,
        phone: payload.phone || payload.contactNumber || undefined,
        isActive: true,
        emailVerified: new Date(),
        clientId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        clientId: true,
      },
    });

    await upsertUserExtendedProfile(created.id, {
      businessName: payload.businessName ?? null,
      abn: payload.abn ?? null,
      address: payload.address ?? payload.clientAddress ?? null,
      contactNumber: payload.contactNumber ?? payload.phone ?? null,
      bankDetails: payload.bankDetails
        ? {
            accountName: payload.bankDetails.accountName ?? "",
            bankName: payload.bankDetails.bankName ?? "",
            bsb: payload.bankDetails.bsb ?? "",
            accountNumber: payload.bankDetails.accountNumber ?? "",
          }
        : null,
    });
    await upsertAuthUserState(created.id, {
      requiresOnboarding: true,
      tutorialSeen: false,
      requiresPasswordReset: false,
      welcomeEmailSent: true,
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CREATE_USER",
        entity: "User",
        entityId: created.id,
        after: {
          email: created.email,
          role: created.role,
          clientId: created.clientId,
          activationMode: "ADMIN_CREATED_ACTIVE",
        } as any,
      },
    });

    return NextResponse.json(
      {
        ...created,
        requiresVerification: false,
        otpSent: false,
        warning: undefined,
      },
      { status: 201 }
    );
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
