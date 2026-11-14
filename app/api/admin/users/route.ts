import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { createUserByAdminSchema } from "@/lib/validations/user";
import { getAppSettings, setProfileOverrideForUser } from "@/lib/settings";
import { z } from "zod";
import { getUserExtendedProfiles } from "@/lib/accounts/user-details";
import { getValidationErrorMessage } from "@/lib/validations/errors";
import { AccountCreateError, createAccountWithInvitation, findAccountByEmail } from "@/lib/accounts/create-account";
import { resolveAccountCreator } from "@/lib/accounts/account-creator";
import { emailInUseMessage, inviteRefusal } from "@/lib/accounts/create-account-rules";
import { accountListError, accountListResponse } from "@/lib/accounts/list/http";

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
  // The Accounts hub's paged, sorted list. Every other caller keeps the plain
  // array below, unchanged.
  if (new URL(req.url).searchParams.get("paginated") === "1") {
    try {
      const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
      return await accountListResponse(session.user, new URL(req.url).searchParams);
    } catch (err) {
      return accountListError(err, "Could not load accounts.");
    }
  }
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
        twoFactorEnabled: true,
        clientId: true,
        profileEditingEnabled: true,
        notificationPreference: {
          select: {
            updatedAt: true,
          },
        },
        client: { select: { id: true, name: true } },
        // Null for everyone except a VA. A VA login means nothing without its
        // team — the team owns the client link, the grants and the property
        // scope — so the directory needs it on the same row.
        vaTeam: {
          select: {
            id: true,
            name: true,
            isActive: true,
            permissions: true,
            propertyIds: true,
            client: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });

    const extendedProfiles = await getUserExtendedProfiles(users.map((user) => user.id));

    return NextResponse.json(
      users.map((user) => ({
        ...user,
        profileEditOverride: settings.profileEditOverrides[user.id] ?? null,
        extendedProfile: extendedProfiles.get(user.id) ?? null,
        notificationPreference: user.notificationPreference,
      }))
    );
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: getValidationErrorMessage(err, "Could not create account.") }, { status });
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

/**
 * POST /api/admin/users — Invite person (and every older caller of this
 * route). Administrators only, never while testing as someone else. Creates
 * the account through the one shared service (lib/accounts/create-account.ts):
 * the single-use, expiring, revocable invitation link (or a password the
 * administrator types), starting packs for an operations manager, optional
 * SMS with the link only when `sendSms` is true, and the provider's answer
 * for the email. Repeat-safe with `idempotencyKey`. The response never holds
 * the link, its token or a password: the page copies the link through the
 * audited Copy link route.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const creator = await resolveAccountCreator(session);
    const refusal = inviteRefusal(creator);
    if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });
    const payload = createUserByAdminSchema.parse(await req.json());
    const email = payload.email.toLowerCase();

    let clientId: string | undefined;
    if (payload.role === "CLIENT" || payload.role === "VA") {
      if (payload.clientId) {
        const client = await db.client.findUnique({
          where: { id: payload.clientId },
          select: { id: true, isActive: true },
        });
        if (!client || !client.isActive) {
          return NextResponse.json({ error: "Selected client does not exist or is inactive." }, { status: 400 });
        }
        clientId = client.id;
      } else if (payload.role === "CLIENT" && payload.clientName) {
        // Older callers could create the client inline; kept for them. Invite person
        // always links an existing client (clients are made in Add client).
        const existing = await findAccountByEmail(email);
        if (existing) {
          return NextResponse.json({ error: emailInUseMessage(existing, "client-login"), code: "EMAIL_IN_USE", existing }, { status: 409 });
        }
        const createdClient = await db.client.create({
          data: {
            name: payload.clientName,
            email,
            phone: payload.contactNumber || payload.phone || undefined,
            address: payload.address || payload.clientAddress || undefined,
            notes: payload.clientNotes || undefined,
          },
        });
        clientId = createdClient.id;
      } else {
        return NextResponse.json({ error: "A client login must be linked to a client." }, { status: 400 });
      }
    }

    const outcome = await createAccountWithInvitation({
      actor: { id: creator.id, role: "ADMIN" },
      origin: "INVITE_PERSON",
      idempotencyKey: payload.idempotencyKey ?? null,
      purpose: payload.role === "CLIENT" ? "client-login" : "staff",
      input: {
        name: payload.name,
        email,
        phone: payload.phone || payload.contactNumber || null,
        role: payload.role as Role,
        clientId: clientId ?? null,
        abn: payload.abn ?? null,
        businessName: payload.businessName ?? null,
        address: payload.address ?? payload.clientAddress ?? null,
        contactNumber: payload.contactNumber ?? payload.phone ?? null,
        jobTitle: payload.jobTitle ?? null,
        department: payload.department ?? null,
        baseLocation: payload.baseLocation ?? null,
        bankDetails: payload.bankDetails ?? null,
        signIn: payload.invite === false ? "PASSWORD" : "INVITATION",
        password: payload.invite === false ? payload.password ?? null : null,
        opsPacks: payload.role === "OPS_MANAGER" ? payload.opsPacks ?? [] : undefined,
        sendSms: payload.invite !== false && payload.sendSms === true,
      },
    });

    const emailSent = outcome.email.state === "ACCEPTED";
    return NextResponse.json(
      {
        ...outcome.user,
        clientId: clientId ?? null,
        outcome,
        requiresVerification: false,
        otpSent: false,
        invitationEmailSent: outcome.signIn === "INVITATION" ? emailSent : false,
        invitationLinkAvailable: outcome.signIn === "INVITATION",
        warning: outcome.signIn === "INVITATION" && !emailSent
          ? "Account created, but the invitation email was not sent. Copy the link and share it yourself."
          : undefined,
        invitationEmailError: outcome.email.error ?? undefined,
      },
      { status: outcome.replayed ? 200 : 201 }
    );
  } catch (err: any) {
    if (err instanceof AccountCreateError) {
      return NextResponse.json({ error: err.message, code: err.code, existing: err.existing }, { status: err.status });
    }
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: getValidationErrorMessage(err, "Could not create account.") }, { status });
  }
}
