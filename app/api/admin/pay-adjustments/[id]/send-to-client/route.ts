import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createClientApproval, listClientApprovals } from "@/lib/commercial/client-approvals";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { resolveAppUrl } from "@/lib/app-url";
import { getAppSettings } from "@/lib/settings";

const schema = z.object({
  amount: z.number().nonnegative(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(6000).optional(),
  currency: z.string().trim().max(8).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const payAdjustment = await db.cleanerPayAdjustment.findUnique({
      where: { id: params.id },
      include: {
        cleaner: { select: { id: true, name: true, email: true } },
        job: {
          select: {
            id: true,
            propertyId: true,
            property: {
              select: {
                id: true,
                name: true,
                clientId: true,
                client: { select: { email: true } },
              },
            },
          },
        },
      },
    });
    if (!payAdjustment) {
      return NextResponse.json({ error: "Pay request not found." }, { status: 404 });
    }

    const linkedApprovals = (await listClientApprovals()).filter((approval) => {
      const metadata = approval.metadata as Record<string, unknown> | null;
      return metadata?.source === "pay_adjustment" && metadata?.payAdjustmentId === payAdjustment.id;
    });
    if (linkedApprovals.some((approval) => approval.status === "PENDING")) {
      return NextResponse.json(
        { error: "A client approval request is already pending for this pay request." },
        { status: 409 }
      );
    }

    const primaryRecipients = await db.user.findMany({
      where: {
        role: Role.CLIENT,
        clientId: payAdjustment.job.property.clientId,
        isActive: true,
      },
      select: { id: true, email: true },
    });

    const fallbackEmail = payAdjustment.job.property.client?.email?.trim().toLowerCase() || null;
    const fallbackRecipients =
      primaryRecipients.length === 0 && fallbackEmail
        ? await db.user.findMany({
            where: {
              role: Role.CLIENT,
              email: fallbackEmail,
              isActive: true,
            },
            select: { id: true, email: true },
          })
        : [];

    const recipientMap = new Map<string, { id: string; email: string | null }>();
    for (const row of [...primaryRecipients, ...fallbackRecipients]) {
      recipientMap.set(row.id, { id: row.id, email: row.email?.trim().toLowerCase() || null });
    }
    const recipients = Array.from(recipientMap.values());
    const recipientEmails = new Set<string>(
      recipients
        .map((row) => row.email)
        .filter((value): value is string => Boolean(value))
    );
    if (fallbackEmail) {
      recipientEmails.add(fallbackEmail);
    }

    if (recipients.length === 0 && recipientEmails.size === 0) {
      return NextResponse.json(
        {
          error:
            "No client recipient found for this property's client. Add a client email or link a client login account before sending approval.",
        },
        { status: 409 }
      );
    }

    const created = await createClientApproval({
      clientId: payAdjustment.job.property.clientId,
      propertyId: payAdjustment.job.propertyId,
      jobId: payAdjustment.job.id,
      title: body.title,
      description: body.description ?? "",
      amount: Number(body.amount),
      currency: body.currency ?? "AUD",
      requestedByUserId: session.user.id,
      expiresAt: body.expiresAt ?? null,
      metadata: {
        source: "pay_adjustment",
        payAdjustmentId: payAdjustment.id,
        cleanerId: payAdjustment.cleanerId,
        cleanerRequestedAmount: payAdjustment.requestedAmount,
        recipientUserIds: recipients.map((row) => row.id),
        recipientEmails: Array.from(recipientEmails),
        sourceClientId: payAdjustment.job.property.clientId,
      },
    });

    if (recipients.length > 0) {
      await db.notification.createMany({
        data: recipients.map((recipient) => ({
          userId: recipient.id,
          jobId: payAdjustment.job.id,
          channel: NotificationChannel.PUSH,
          subject: "Approval required",
          body: `${payAdjustment.job.property.name}: ${created.title}`,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        })),
      });
    }

    if (recipientEmails.size > 0) {
      const settings = await getAppSettings();
      const approvalUrl = resolveAppUrl("/client/approvals", req);
      await sendEmailDetailed({
        to: Array.from(recipientEmails),
        subject: `${settings.companyName} - Approval required`,
        html: `
          <p>An approval is required for <strong>${payAdjustment.job.property.name}</strong>.</p>
          <p><strong>${created.title}</strong></p>
          <p>Amount: ${created.currency} ${created.amount.toFixed(2)}</p>
          ${created.description ? `<p>${created.description.replace(/</g, "&lt;")}</p>` : ""}
          <p>Review here: <a href="${approvalUrl}">${approvalUrl}</a></p>
        `,
      });
    }

    await db.notification.createMany({
      data: [
        {
          userId: session.user.id,
          jobId: payAdjustment.job.id,
          channel: NotificationChannel.PUSH,
          subject: "Pay request sent to client",
          body: `Sent ${created.currency} ${created.amount.toFixed(2)} for client approval.`,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
        {
          userId: payAdjustment.cleanerId,
          jobId: payAdjustment.job.id,
          channel: NotificationChannel.PUSH,
          subject: "Pay request shared with client",
          body: `Admin sent a client approval request for ${payAdjustment.job.property.name}.`,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      ],
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: payAdjustment.job.id,
        action: "PAY_ADJUSTMENT_SENT_TO_CLIENT",
        entity: "CleanerPayAdjustment",
        entityId: payAdjustment.id,
        after: {
          clientApprovalId: created.id,
          amount: created.amount,
          currency: created.currency,
        } as any,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not send to client." }, { status });
  }
}
