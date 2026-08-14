import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { logger } from "@/lib/logger";
import { getClientApprovalById, counterClientApproval } from "@/lib/commercial/client-approvals";
import { recordApprovalDecision } from "@/lib/admin/approval-history-write";

/**
 * CP-3b — the client proposes different terms instead of a plain yes/no.
 *
 * Access mirrors the respond route exactly (same client-id / recipient checks),
 * because countering IS a response: anyone allowed to say no is allowed to say
 * "not at that price".
 */
const counterSchema = z.object({
  amount: z.number().nonnegative().max(1_000_000),
  note: z.string().trim().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const body = counterSchema.parse(await req.json().catch(() => ({})));
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

    const updated = await counterClientApproval({
      id: params.id,
      clientId: approval.clientId,
      amount: body.amount,
      note: body.note ?? null,
      counteredByUserId: session.user.id,
    });
    if (!updated) {
      return NextResponse.json({ error: "Approval not found." }, { status: 404 });
    }

    // A counter is a decision the admin side must be able to find later, not
    // just a transient notification — same reason the respond route records one.
    await recordApprovalDecision({
      queue: "clientApprovals",
      decision: "EDITED",
      userId: session.user.id,
      entity: "ClientApproval",
      entityId: updated.id,
      jobId: updated.jobId,
      label: updated.title,
      amount: updated.counterAmount,
      value: updated.amount,
      note: updated.counterNote,
      subjectUserId: session.user.id,
      subjectName: user.name ?? user.email ?? null,
      fromStatus: "PENDING",
      toStatus: "COUNTERED",
    });

    // Tell admin/ops. Best-effort: the counter is already saved.
    try {
      const admins = await db.user.findMany({
        where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
        select: { id: true, email: true },
        take: 20,
      });
      if (admins.length > 0) {
        await db.notification.createMany({
          data: admins.map((admin) => ({
            userId: admin.id,
            channel: NotificationChannel.PUSH,
            subject: "Client counter-offer",
            body: `${updated.title}: asked ${updated.currency} ${updated.amount.toFixed(2)}, client offered ${updated.currency} ${(updated.counterAmount ?? 0).toFixed(2)}`,
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          })),
        });
        const settings = await getAppSettings();
        const to = admins.map((a) => a.email).filter((email): email is string => Boolean(email));
        if (to.length > 0) {
          await sendEmailDetailed({
            kind: "admin_alert",
            to,
            subject: `${settings.companyName} - Client counter-offer`,
            html: `
              <p>A client responded with a counter-offer for: <strong>${updated.title.replace(/</g, "&lt;")}</strong></p>
              <p>Asked: ${updated.currency} ${updated.amount.toFixed(2)}<br/>
                 Client offered: <strong>${updated.currency} ${(updated.counterAmount ?? 0).toFixed(2)}</strong></p>
              ${updated.counterNote ? `<p>Client note: ${updated.counterNote.replace(/</g, "&lt;")}</p>` : ""}
            `,
          });
        }
      }
    } catch (err) {
      logger.error({ err, approvalId: updated.id }, "CP-3b: counter-offer admin notification failed");
    }

    return NextResponse.json(updated);
  } catch (err: any) {
    if (err.message === "INVALID_STATE") {
      return NextResponse.json(
        { error: "This approval can no longer be countered." },
        { status: 409 }
      );
    }
    if (err.message === "INVALID_AMOUNT") {
      return NextResponse.json({ error: "Enter a valid amount." }, { status: 400 });
    }
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Counter-offer failed." }, { status });
  }
}
