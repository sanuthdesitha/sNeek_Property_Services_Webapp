import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { getClientApprovalById, respondClientApproval } from "@/lib/commercial/client-approvals";

const respondSchema = z.object({
  decision: z.enum(["APPROVE", "DECLINE"]),
  responseNote: z.string().trim().max(2000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const body = respondSchema.parse(await req.json().catch(() => ({})));
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { clientId: true, name: true, email: true },
    });
    if (!user) {
      return NextResponse.json({ error: "Client account not found." }, { status: 404 });
    }
    const approval = await getClientApprovalById(params.id);
    if (!approval) {
      return NextResponse.json({ error: "Approval not found." }, { status: 404 });
    }

    const normalizedEmail = user.email?.trim().toLowerCase() || null;
    const emailMatchedClientIds = normalizedEmail
      ? (
          await db.client.findMany({
            where: { email: normalizedEmail },
            select: { id: true },
            take: 20,
          })
        ).map((row) => row.id)
      : [];
    const allowedClientIds = new Set<string>(
      [user.clientId, ...emailMatchedClientIds].filter((value): value is string => Boolean(value))
    );

    const metadata =
      approval.metadata && typeof approval.metadata === "object"
        ? (approval.metadata as Record<string, unknown>)
        : null;
    const recipientUserIds = Array.isArray(metadata?.recipientUserIds)
      ? metadata!.recipientUserIds
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
    const recipientEmails = Array.isArray(metadata?.recipientEmails)
      ? metadata!.recipientEmails
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
      : [];

    const canAccess =
      allowedClientIds.has(approval.clientId) ||
      recipientUserIds.includes(session.user.id) ||
      (normalizedEmail ? recipientEmails.includes(normalizedEmail) : false);

    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const updated = await respondClientApproval({
      id: params.id,
      clientId: approval.clientId,
      decision: body.decision,
      responseNote: body.responseNote ?? null,
      respondedByUserId: session.user.id,
    });
    if (!updated) {
      return NextResponse.json({ error: "Approval not found." }, { status: 404 });
    }

    const admins = await db.user.findMany({
      where: { role: Role.ADMIN, isActive: true },
      select: { id: true, email: true, name: true },
      take: 20,
    });
    if (admins.length > 0) {
      await db.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          channel: NotificationChannel.PUSH,
          subject: `Client approval ${updated.status.toLowerCase()}`,
          body: `${updated.title} (${updated.currency} ${updated.amount.toFixed(2)})`,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        })),
      });

      const settings = await getAppSettings();
      const to = admins.map((admin) => admin.email).filter((email): email is string => Boolean(email));
      if (to.length > 0) {
        await sendEmailDetailed({
          to,
          subject: `${settings.companyName} - Client approval ${updated.status.toLowerCase()}`,
          html: `
            <p>Client decision received for: <strong>${updated.title}</strong></p>
            <p>Status: <strong>${updated.status}</strong></p>
            <p>Amount: ${updated.currency} ${updated.amount.toFixed(2)}</p>
            ${
              updated.responseNote
                ? `<p>Client note: ${updated.responseNote.replace(/</g, "&lt;")}</p>`
                : ""
            }
          `,
        });
      }
    }

    return NextResponse.json(updated);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    if (err.message === "INVALID_STATE") {
      return NextResponse.json(
        { error: "This approval can no longer be responded to." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: err.message ?? "Response failed." }, { status });
  }
}
