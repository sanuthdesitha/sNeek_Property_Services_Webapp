import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getProfilePolicyForUser } from "@/lib/settings";
import { getUserNotificationPreferences } from "@/lib/notifications/preferences";
import { profileUpdateSchema } from "@/lib/validations/user";
import { getValidationErrorMessage } from "@/lib/validations/errors";

// V9 extended profile schema — allowlist of self-updateable fields beyond
// the legacy name/email/phone/image set already governed by profileUpdateSchema.
const extendedProfileSchema = z.object({
  dateOfBirth: z.string().nullable().optional(),
  emergencyContactName: z.string().max(100).optional(),
  emergencyContactPhone: z.string().max(30).optional(),
  emergencyContactRelation: z.string().max(50).optional(),
  // address fields (cleaner home address / client billing address)
  address: z.string().max(255).optional(),
  suburb: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  postcode: z.string().max(20).optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  placeId: z.string().nullable().optional(),
  // cleaner-specific
  visaStatus: z
    .enum(["CITIZEN", "PERMANENT_RESIDENT", "WORK_VISA", "STUDENT_VISA", "OTHER"])
    .nullable()
    .optional(),
  employmentType: z
    .enum(["CONTRACTOR", "CASUAL", "PART_TIME", "FULL_TIME"])
    .nullable()
    .optional(),
  abn: z.string().max(20).optional(),
  bankBsb: z.string().max(10).optional(),
  bankAccountNumber: z.string().max(30).optional(),
  bankAccountName: z.string().max(100).optional(),
  languages: z.array(z.string()).optional(),
  hasVehicle: z.boolean().optional(),
  vehicleRegoExpiry: z.string().nullable().optional(),
  driverLicenseExpiry: z.string().nullable().optional(),
  taxFileNumberOnFile: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

// Fields the legacy profileUpdateSchema handles; anything else in the body
// is treated as an extended-field payload.
const LEGACY_FIELDS = new Set(["name", "phone", "email", "image"]);

export async function GET() {
  try {
    const session = await requireSession();
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        image: true,
        profileEditingEnabled: true,
        // Extended profile fields (cleaner contractor details). Surfaced so the
        // profile settings page can prefill the same fields the completeness
        // gate checks. The PATCH route already accepts all of these.
        dateOfBirth: true,
        address: true,
        suburb: true,
        state: true,
        postcode: true,
        latitude: true,
        longitude: true,
        placeId: true,
        abn: true,
        visaStatus: true,
        employmentType: true,
        taxFileNumberOnFile: true,
        bankAccountName: true,
        bankBsb: true,
        bankAccountNumber: true,
        emergencyContactName: true,
        emergencyContactPhone: true,
        emergencyContactRelation: true,
      },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const [editPolicy, notificationPreferences] = await Promise.all([
      getProfilePolicyForUser(user.id, user.role),
      getUserNotificationPreferences(user.id),
    ]);
    return NextResponse.json({
      user,
      editPolicy,
      notificationPreferences,
      profileEditingEnabled: user.profileEditingEnabled,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    const rawBody = await req.json();

    // Split incoming payload into legacy (name/email/phone/image) + extended.
    const legacyInput: Record<string, unknown> = {};
    const extendedInput: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawBody ?? {})) {
      if (LEGACY_FIELDS.has(k)) legacyInput[k] = v;
      else extendedInput[k] = v;
    }
    const body = profileUpdateSchema.parse(legacyInput);
    const extendedBody = Object.keys(extendedInput).length
      ? extendedProfileSchema.parse(extendedInput)
      : null;

    const current = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        role: true,
        email: true,
        name: true,
        phone: true,
        image: true,
        profileEditingEnabled: true,
      },
    });
    if (!current) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Admins always retain the ability to edit their own profile, even if a
    // misconfigured override flips the flag off on their account.
    if (current.profileEditingEnabled === false && current.role !== Role.ADMIN) {
      return NextResponse.json(
        { error: "Profile editing has been disabled by an administrator." },
        { status: 403 }
      );
    }

    const policy = await getProfilePolicyForUser(current.id, current.role as Role);
    const data: Record<string, unknown> = {};
    const currentName = (current.name ?? "").trim();
    const currentPhone = (current.phone ?? "").trim();
    const currentEmail = current.email.trim().toLowerCase();

    if (body.name !== undefined) {
      if (!policy.canEditName) {
        if (body.name.trim() !== currentName) {
          return NextResponse.json({ error: "Name editing is disabled for your role." }, { status: 403 });
        }
      } else {
        data.name = body.name;
      }
    }

    if (body.phone !== undefined) {
      if (!policy.canEditPhone) {
        if (body.phone.trim() != currentPhone) {
          return NextResponse.json({ error: "Phone editing is disabled for your role." }, { status: 403 });
        }
      } else {
        data.phone = body.phone || null;
      }
    }

    if (body.email !== undefined) {
      const normalizedEmail = body.email.toLowerCase();
      if (!policy.canEditEmail) {
        if (normalizedEmail !== currentEmail) {
          return NextResponse.json({ error: "Email editing is disabled for your role." }, { status: 403 });
        }
      } else {
        if (normalizedEmail !== currentEmail) {
          const existing = await db.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } });
          if (existing && existing.id !== current.id) {
            return NextResponse.json({ error: "Email is already in use." }, { status: 409 });
          }
        }
        data.email = normalizedEmail;
      }
    }

    if (body.image !== undefined) {
      data.image = body.image || null;
    }

    if (extendedBody) {
      const dateKeys = ["dateOfBirth", "vehicleRegoExpiry", "driverLicenseExpiry"] as const;
      for (const [k, v] of Object.entries(extendedBody)) {
        if (v === undefined) continue;
        if ((dateKeys as readonly string[]).includes(k)) {
          data[k] = v === null ? null : new Date(v as string);
        } else {
          data[k] = v;
        }
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No changes submitted." }, { status: 400 });
    }

    const updated = await db.user.update({
      where: { id: current.id },
      data: data as any,
      select: { id: true, name: true, email: true, phone: true, role: true, image: true },
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : 400;
    return NextResponse.json({ error: getValidationErrorMessage(err, "Could not update profile.") }, { status });
  }
}
