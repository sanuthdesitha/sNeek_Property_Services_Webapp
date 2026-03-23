import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getUserExtendedProfile, upsertUserExtendedProfile } from "@/lib/accounts/user-details";
import {
  getAuthUserState,
  getMissingRequiredProfileFields,
  upsertAuthUserState,
} from "@/lib/auth/account-state";
import { notifyAdminsOfNewProfile } from "@/lib/notifications/profile-created";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().max(32).optional(),
  businessName: z.string().trim().max(200).optional(),
  abn: z.string().trim().max(32).optional(),
  address: z.string().trim().max(500).optional(),
  contactNumber: z.string().trim().max(32).optional(),
  bankDetails: z
    .object({
      accountName: z.string().trim().max(160).optional(),
      bankName: z.string().trim().max(160).optional(),
      bsb: z.string().trim().max(16).optional(),
      accountNumber: z.string().trim().max(32).optional(),
    })
    .optional(),
  tutorialSeen: z.boolean().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, email: true, phone: true, role: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const [extendedProfile, state] = await Promise.all([
      getUserExtendedProfile(user.id),
      getAuthUserState(user.id),
    ]);
    const missingFields = getMissingRequiredProfileFields(user.role, extendedProfile);
    const tutorialSeen = state?.tutorialSeen === true;
    const requiresOnboarding = state?.requiresOnboarding === true;

    return NextResponse.json({
      user,
      extendedProfile,
      state: {
        requiresOnboarding,
        tutorialSeen,
      },
      missingFields,
      onboardingComplete: tutorialSeen && missingFields.length === 0,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = patchSchema.parse(await req.json().catch(() => ({})));

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, role: true, name: true, phone: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const userUpdate: { name?: string; phone?: string | null } = {};
    if (body.name !== undefined) userUpdate.name = body.name;
    if (body.phone !== undefined) userUpdate.phone = body.phone || null;
    if (Object.keys(userUpdate).length > 0) {
      await db.user.update({ where: { id: user.id }, data: userUpdate });
    }

    const resolvedContactNumber =
      body.contactNumber !== undefined ? body.contactNumber : body.phone !== undefined ? body.phone : undefined;

    const extendedProfile = await upsertUserExtendedProfile(user.id, {
      businessName: body.businessName,
      abn: body.abn,
      address: body.address,
      contactNumber: resolvedContactNumber,
      bankDetails: body.bankDetails
        ? {
            accountName: body.bankDetails.accountName ?? "",
            bankName: body.bankDetails.bankName ?? "",
            bsb: body.bankDetails.bsb ?? "",
            accountNumber: body.bankDetails.accountNumber ?? "",
          }
        : undefined,
    });

    const currentState = await getAuthUserState(user.id);
    const missingFields = getMissingRequiredProfileFields(user.role as Role, extendedProfile);
    const tutorialSeen = body.tutorialSeen ?? currentState?.tutorialSeen ?? false;
    const requiresOnboarding = currentState?.requiresOnboarding
      ? !(tutorialSeen && missingFields.length === 0)
      : false;

    const wasOnboardingRequired = currentState?.requiresOnboarding === true;
    const nextState = await upsertAuthUserState(user.id, {
      tutorialSeen,
      requiresOnboarding,
    });

    if (wasOnboardingRequired && !nextState.requiresOnboarding && !currentState?.profileCreationNotified) {
      const fullUser = await db.user.findUnique({
        where: { id: user.id },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });
      if (fullUser) {
        await notifyAdminsOfNewProfile({
          userId: fullUser.id,
          userName: fullUser.name ?? fullUser.email,
          email: fullUser.email,
          role: fullUser.role,
          createdVia: "invited account onboarding",
          createdAt: fullUser.createdAt,
        });
        await upsertAuthUserState(user.id, { profileCreationNotified: true });
      }
    }

    return NextResponse.json({
      ok: true,
      extendedProfile,
      missingFields,
      state: {
        requiresOnboarding: nextState.requiresOnboarding,
        tutorialSeen: nextState.tutorialSeen,
      },
      onboardingComplete: nextState.tutorialSeen && missingFields.length === 0,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
