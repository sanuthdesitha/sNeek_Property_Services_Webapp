import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { LeadStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { generateTempPassword } from "@/lib/auth/temp-password";
import { upsertAuthUserState } from "@/lib/auth/account-state";
import { getAppSettings } from "@/lib/settings";
import { renderEmailTemplate } from "@/lib/email-templates";
import { resolveAppUrl } from "@/lib/app-url";
import { sendEmailDetailed } from "@/lib/notifications/email";

function buildPropertyName(address: string | null | undefined, suburb: string | null | undefined, clientName: string) {
  const primary = String(address ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)[0];
  if (primary) return primary;
  if (suburb?.trim()) return `${suburb.trim()} Property`;
  return `${clientName.trim()} Property`;
}

function deriveAddress(lead: { address: string | null; suburb: string | null }) {
  const address = lead.address?.trim();
  const suburb = lead.suburb?.trim();
  if (address) return address;
  if (suburb) return suburb;
  return "Address pending";
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const lead = await db.quoteLead.findUnique({
      where: { id: params.id },
      include: { client: true },
    });
    if (!lead) {
      return NextResponse.json({ error: "Lead not found." }, { status: 404 });
    }
    if (lead.clientId && lead.client) {
      return NextResponse.json({ clientId: lead.client.id, userId: null });
    }

    const email = lead.email.trim().toLowerCase();
    const existingUser = await db.user.findUnique({
      where: { email },
      select: { id: true, role: true, clientId: true },
    });
    if (existingUser) {
      return NextResponse.json(
        { error: "Another account already uses this email. Update that account or change the lead email first." },
        { status: 409 }
      );
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const propertyAddress = deriveAddress(lead);

    const result = await db.$transaction(async (tx) => {
      const client = await tx.client.create({
        data: {
          name: lead.name,
          email,
          phone: lead.phone?.trim() || undefined,
          address: propertyAddress,
          notes: lead.notes?.trim() || undefined,
        },
      });

      const user = await tx.user.create({
        data: {
          name: lead.name,
          email,
          role: Role.CLIENT,
          phone: lead.phone?.trim() || undefined,
          clientId: client.id,
          isActive: true,
          emailVerified: new Date(),
          passwordHash,
        },
        select: { id: true, name: true, email: true },
      });

      await tx.property.create({
        data: {
          clientId: client.id,
          name: buildPropertyName(lead.address, lead.suburb, lead.name),
          address: propertyAddress,
          suburb: lead.suburb?.trim() || "Sydney",
          bedrooms: lead.bedrooms ?? 1,
          bathrooms: lead.bathrooms ?? 1,
          hasBalcony: lead.hasBalcony === true,
        },
      });

      await tx.quoteLead.update({
        where: { id: lead.id },
        data: {
          clientId: client.id,
          status: LeadStatus.CONVERTED,
        },
      });

      return { client, user };
    });

    await upsertAuthUserState(result.user.id, {
      requiresOnboarding: true,
      requiresPasswordReset: true,
      tutorialSeen: false,
      welcomeEmailSent: false,
      profileCreationNotified: false,
    });

    const settings = await getAppSettings();
    const template = renderEmailTemplate(settings, "accountInvite", {
      userName: result.user.name ?? result.user.email,
      role: "CLIENT",
      email: result.user.email,
      tempPassword,
      welcomeNote: "",
      actionUrl: resolveAppUrl("/login", req),
      actionLabel: "Sign in and set your password",
    });
    const emailResult = await sendEmailDetailed({
      to: result.user.email,
      subject: template.subject,
      html: template.html,
    });
    if (emailResult.ok) {
      await upsertAuthUserState(result.user.id, { welcomeEmailSent: true });
    }

    return NextResponse.json({
      clientId: result.client.id,
      userId: result.user.id,
      warning: emailResult.ok ? undefined : emailResult.error ?? "Client created but the invite email failed.",
    });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED"
        ? 401
        : err.message === "FORBIDDEN"
          ? 403
          : err?.code === "P2002"
            ? 409
            : 400;
    return NextResponse.json({ error: err.message ?? "Could not convert lead to client." }, { status });
  }
}
