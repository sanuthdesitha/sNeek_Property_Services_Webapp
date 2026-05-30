import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, PayAdjustmentStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";
import { listClientApprovals } from "@/lib/commercial/client-approvals";

const updateSchema = z.object({
  status: z.union([z.literal(PayAdjustmentStatus.APPROVED), z.literal(PayAdjustmentStatus.REJECTED)]).optional(),
  approvedAmount: z.number().positive().optional(),
  adminNote: z.string().trim().max(4000).optional(),
  propertyId: z.string().cuid().optional().nullable(),
  title: z.string().trim().min(1).max(160).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = updateSchema.parse(await req.json().catch(() => ({})));
    const existing = await db.cleanerPayAdjustment.findUnique({
      where: { id: params.id },
      include: {
        cleaner: { select: { id: true, name: true, email: true } },
        property: {
          select: {
            id: true,
            name: true,
            suburb: true,
          },
        },
        job: {
          select: {
            id: true,
            jobType: true,
            property: { select: { name: true } },
          },
        },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }

    const isStatusChange = Boolean(body.status);
    // Editing the approved amount on a request that has already been approved
    // (no status change, but a new approvedAmount supplied).
    const isAmountEdit =
      !isStatusChange &&
      body.approvedAmount !== undefined &&
      existing.status === PayAdjustmentStatus.APPROVED;

    if (
      !isStatusChange &&
      body.approvedAmount !== undefined &&
      existing.status !== PayAdjustmentStatus.APPROVED
    ) {
      return NextResponse.json(
        {
          error:
            "The approved amount can only be edited on a request that is already approved. Approve the request first.",
        },
        { status: 400 }
      );
    }

    const previousApprovedAmount = existing.approvedAmount;
    const approvedAmount =
      body.status === PayAdjustmentStatus.APPROVED
        ? body.approvedAmount ?? existing.requestedAmount
        : isAmountEdit
        ? body.approvedAmount!
        : null;

    if (body.status === PayAdjustmentStatus.APPROVED) {
      const linkedApprovals = (await listClientApprovals()).filter((approval) => {
        const metadata = approval.metadata as Record<string, unknown> | null;
        return metadata?.source === "pay_adjustment" && metadata?.payAdjustmentId === existing.id;
      });
      if (linkedApprovals.length > 0) {
        const latest = linkedApprovals.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )[0];
        if (latest.status !== "APPROVED") {
          return NextResponse.json(
            {
              error:
                "Client approval is required before approving this cleaner payment request.",
              clientApprovalStatus: latest.status,
              clientApprovalId: latest.id,
            },
            { status: 409 }
          );
        }
      }
    }

    const updated = await db.cleanerPayAdjustment.update({
      where: { id: params.id },
      data: {
        ...(isStatusChange
          ? { status: body.status, approvedAmount, reviewedAt: new Date(), reviewedById: session.user.id }
          : {}),
        ...(isAmountEdit
          ? { approvedAmount, reviewedAt: new Date(), reviewedById: session.user.id }
          : {}),
        ...(body.adminNote !== undefined ? { adminNote: body.adminNote.trim() || null } : {}),
        ...(body.propertyId !== undefined ? { propertyId: body.propertyId } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
      },
      include: {
        cleaner: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
        property: {
          select: {
            id: true,
            name: true,
            suburb: true,
          },
        },
        job: {
          select: {
            id: true,
            jobType: true,
            property: { select: { id: true, name: true, suburb: true } },
          },
        },
      },
    });

    if (isStatusChange || isAmountEdit) {
      const propertyName = updated.job?.property?.name ?? updated.property?.name ?? "Unlinked request";
      const note = updated.adminNote ? ` Note: ${updated.adminNote}` : "";
      const newAmount = Number(updated.approvedAmount ?? 0).toFixed(2);

      let pushSubject: string;
      let pushBody: string;
      let emailSubject: string;
      let emailIntro: string;

      if (isAmountEdit) {
        const oldAmount = Number(previousApprovedAmount ?? 0).toFixed(2);
        pushSubject = `Approved payment updated - ${propertyName}`;
        pushBody = `Your approved payment for ${propertyName} was updated from $${oldAmount} to $${newAmount}.${note}`;
        emailSubject = "Approved Payment Updated";
        emailIntro = `<p>Your approved extra payment for <strong>${propertyName}</strong> has been updated from <strong>$${oldAmount}</strong> to <strong>$${newAmount}</strong>.</p>`;
      } else {
        pushSubject = `Extra payment request ${updated.status.toLowerCase()} - ${propertyName}`;
        pushBody =
          updated.status === PayAdjustmentStatus.APPROVED
            ? `Approved $${newAmount} for ${propertyName}.${note}`
            : `Rejected extra payment request for ${propertyName}.${note}`;
        emailSubject = `Extra Payment Request ${updated.status}`;
        emailIntro = `<p>Your extra payment request for <strong>${propertyName}</strong> has been <strong>${updated.status.toLowerCase()}</strong>.</p>${
          updated.status === PayAdjustmentStatus.APPROVED
            ? `<p><strong>Approved amount:</strong> $${newAmount}</p>`
            : ""
        }`;
      }

      await db.notification.create({
        data: {
          userId: updated.cleaner.id,
          jobId: updated.job?.id ?? undefined,
          channel: NotificationChannel.PUSH,
          subject: pushSubject,
          body: pushBody,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });

      const settings = await getAppSettings();
      await sendEmailDetailed({
        to: updated.cleaner.email,
        subject: `${settings.companyName} - ${emailSubject}`,
        html: `
          <p>Hello ${updated.cleaner.name ?? updated.cleaner.email},</p>
          ${emailIntro}
          ${updated.adminNote ? `<p><strong>Admin note:</strong> ${updated.adminNote.replace(/</g, "&lt;")}</p>` : ""}
        `,
      });
    }

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: updated.job?.id ?? undefined,
        action: isAmountEdit ? "EDIT_PAY_ADJUSTMENT_AMOUNT" : "REVIEW_PAY_ADJUSTMENT",
        entity: "CleanerPayAdjustment",
        entityId: updated.id,
        before: isAmountEdit ? ({ approvedAmount: previousApprovedAmount } as any) : undefined,
        after: {
          status: updated.status,
          approvedAmount: updated.approvedAmount,
          adminNote: updated.adminNote,
        } as any,
      },
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
