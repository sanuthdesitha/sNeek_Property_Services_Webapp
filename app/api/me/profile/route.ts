import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getProfilePolicyForUser } from "@/lib/settings";
import { getUserNotificationPreferences } from "@/lib/notifications/preferences";
import { profileUpdateSchema } from "@/lib/validations/user";
import { getValidationErrorMessage } from "@/lib/validations/errors";

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
      },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const [editPolicy, notificationPreferences] = await Promise.all([
      getProfilePolicyForUser(user.id, user.role),
      getUserNotificationPreferences(user.id),
    ]);
    return NextResponse.json({ user, editPolicy, notificationPreferences });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = profileUpdateSchema.parse(await req.json());
    const current = await db.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, role: true, email: true, name: true, phone: true, image: true },
    });
    if (!current) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const policy = await getProfilePolicyForUser(current.id, current.role as Role);
    const data: { name?: string; phone?: string | null; email?: string; image?: string | null } = {};
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

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No changes submitted." }, { status: 400 });
    }

    const updated = await db.user.update({
      where: { id: current.id },
      data,
      select: { id: true, name: true, email: true, phone: true, role: true, image: true },
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : 400;
    return NextResponse.json({ error: getValidationErrorMessage(err, "Could not update profile.") }, { status });
  }
}
