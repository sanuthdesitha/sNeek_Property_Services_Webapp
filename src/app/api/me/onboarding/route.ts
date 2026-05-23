import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getUserExtendedProfile,
  upsertUserExtendedProfile,
  getMissingRequiredProfileFields,
} from "@/lib/accounts/user-details";
import { getAuthUserState, upsertAuthUserState } from "@/lib/auth/account-state";

export const runtime = "nodejs";

const bankSchema = z
  .object({
    accountName: z.string().optional(),
    bankName: z.string().optional(),
    bsb: z.string().optional(),
    accountNumber: z.string().optional(),
  })
  .optional();

const patchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  phone: z.string().trim().max(32).optional(),
  contactNumber: z.string().trim().max(32).optional(),
  address: z.string().trim().max(500).optional(),
  businessName: z.string().trim().max(200).optional(),
  abn: z.string().trim().max(32).optional(),
  bankDetails: bankSchema,
  tutorialSeen: z.boolean().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, phone: true, role: true },
  });
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

  const [extendedProfile, state] = await Promise.all([
    getUserExtendedProfile(user.id),
    getAuthUserState(user.id),
  ]);
  const missingFields = getMissingRequiredProfileFields(user.role as any, extendedProfile);
  const tutorialSeen = state?.tutorialSeen === true;
  const requiresOnboarding = state?.requiresOnboarding === true;

  return NextResponse.json({
    user,
    extendedProfile,
    state: { requiresOnboarding, tutorialSeen },
    missingFields,
    onboardingComplete: tutorialSeen && missingFields.length === 0,
  });
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json().catch(() => ({})));
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.issues?.[0]?.message ?? "Invalid request body." },
      { status: 400 }
    );
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true },
  });
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

  const userUpdate: { name?: string; phone?: string | null } = {};
  if (body.name !== undefined) userUpdate.name = body.name;
  if (body.phone !== undefined) userUpdate.phone = body.phone || null;
  if (Object.keys(userUpdate).length > 0) {
    await db.user.update({ where: { id: user.id }, data: userUpdate });
  }

  const resolvedContactNumber =
    body.contactNumber !== undefined
      ? body.contactNumber
      : body.phone !== undefined
        ? body.phone
        : undefined;

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
  const missingFields = getMissingRequiredProfileFields(user.role as any, extendedProfile);
  const tutorialSeen = body.tutorialSeen ?? currentState?.tutorialSeen ?? false;
  const requiresOnboarding = currentState?.requiresOnboarding
    ? !(tutorialSeen && missingFields.length === 0)
    : false;

  const nextState = await upsertAuthUserState(user.id, { tutorialSeen, requiresOnboarding });

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
}