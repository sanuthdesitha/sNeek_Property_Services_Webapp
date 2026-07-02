import { NextRequest, NextResponse } from "next/server";
import {
  NotificationChannel,
  NotificationStatus,
  PayAdjustmentStatus,
  PayAdjustmentType,
  Role,
} from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";
import { listClientApprovals, deleteClientApprovalById } from "@/lib/commercial/client-approvals";
import { roundCents } from "@/lib/finance/job-money";

const updateSchema = z.object({
  // Status changes now include reversing back to PENDING (admins can undo a
  // previous decision "even after it has been sent").
  status: z.nativeEnum(PayAdjustmentStatus).optional(),
  approvedAmount: z.number().positive().optional(),
  adminNote: z.string().trim().max(4000).optional(),
  propertyId: z.string().cuid().optional().nullable(),
  jobId: z.string().cuid().optional().nullable(),
  title: z.string().trim().min(1).max(160).optional(),
  // Full edit of the underlying request the cleaner/client both read.
  type: z.nativeEnum(PayAdjustmentType).optional(),
  requestedAmount: z.number().positive().optional(),
  requestedHours: z.number().positive().nullable().optional(),
  requestedRate: z.number().positive().nullable().optional(),
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

    const isStatusChange = Boolean(body.status) && body.status !== existing.status;
    // Reversing a previously-actioned request back to PENDING (admins can undo a
    // decision even after it was sent to the cleaner/client). This also removes it
    // from payroll automatically, because payroll filters on status === APPROVED.
    const isReverseToPending =
      body.status === PayAdjustmentStatus.PENDING &&
      existing.status !== PayAdjustmentStatus.PENDING;
    // Editing the approved amount on a request that has already been approved
    // (no status change, but a new approvedAmount supplied).
    const isAmountEdit =
      !isStatusChange &&
      body.approvedAmount !== undefined &&
      existing.status === PayAdjustmentStatus.APPROVED;
    // Editing the underlying request fields (the single source row both the
    // cleaner and client read). Allowed at any time / any status.
    const isFieldEdit =
      body.type !== undefined ||
      body.requestedAmount !== undefined ||
      body.requestedHours !== undefined ||
      body.requestedRate !== undefined ||
      body.jobId !== undefined;

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
    // Resolve the resulting request fields so we can recompute requestedAmount for
    // HOURLY edits (hours * rate) when only one side is supplied.
    const resolvedType = body.type ?? existing.type;
    const resolvedHours = body.requestedHours !== undefined ? body.requestedHours : existing.requestedHours;
    const resolvedRate = body.requestedRate !== undefined ? body.requestedRate : existing.requestedRate;
    let editedRequestedAmount: number | undefined;
    if (isFieldEdit) {
      if (resolvedType === PayAdjustmentType.HOURLY) {
        if (body.requestedAmount !== undefined) {
          editedRequestedAmount = body.requestedAmount;
        } else if (
          resolvedHours != null &&
          resolvedRate != null &&
          Number.isFinite(resolvedHours) &&
          Number.isFinite(resolvedRate)
        ) {
          editedRequestedAmount = roundCents(Number(resolvedHours) * Number(resolvedRate));
        }
      } else if (body.requestedAmount !== undefined) {
        editedRequestedAmount = body.requestedAmount;
      }
      if (editedRequestedAmount !== undefined && (!Number.isFinite(editedRequestedAmount) || editedRequestedAmount <= 0)) {
        return NextResponse.json(
          { error: "The edited request amount must be greater than zero." },
          { status: 400 }
        );
      }
    }
    // Reversing to PENDING clears the prior decision; an approve/reject sets it.
    const approvedAmountRaw = isReverseToPending
      ? null
      : body.status === PayAdjustmentStatus.APPROVED
      ? body.approvedAmount ?? existing.requestedAmount
      : isAmountEdit
      ? body.approvedAmount!
      : body.status === PayAdjustmentStatus.REJECTED
      ? null
      : existing.approvedAmount;
    // Round to whole cents so the stored amount can't carry >2 decimals (which
    // drift 1c against payroll/invoice totals that round on display).
    const approvedAmount =
      approvedAmountRaw == null || !Number.isFinite(Number(approvedAmountRaw))
        ? approvedAmountRaw
        : roundCents(Number(approvedAmountRaw));

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

    // Validate a re-linked job exists before writing it.
    if (body.jobId) {
      const job = await db.job.findUnique({ where: { id: body.jobId }, select: { id: true } });
      if (!job) {
        return NextResponse.json({ error: "Linked job not found." }, { status: 404 });
      }
    }

    const updated = await db.cleanerPayAdjustment.update({
      where: { id: params.id },
      data: {
        ...(isReverseToPending
          ? {
              status: PayAdjustmentStatus.PENDING,
              approvedAmount: null,
              reviewedAt: null,
              reviewedById: null,
            }
          : isStatusChange
          ? { status: body.status, approvedAmount, reviewedAt: new Date(), reviewedById: session.user.id }
          : {}),
        ...(isAmountEdit
          ? { approvedAmount, reviewedAt: new Date(), reviewedById: session.user.id }
          : {}),
        ...(body.adminNote !== undefined ? { adminNote: body.adminNote.trim() || null } : {}),
        ...(body.propertyId !== undefined ? { propertyId: body.propertyId } : {}),
        ...(body.jobId !== undefined ? { jobId: body.jobId } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        // Full field edit of the underlying request both cleaner + client read.
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.requestedHours !== undefined ? { requestedHours: body.requestedHours } : {}),
        ...(body.requestedRate !== undefined ? { requestedRate: body.requestedRate } : {}),
        ...(editedRequestedAmount !== undefined ? { requestedAmount: editedRequestedAmount } : {}),
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

      if (isReverseToPending) {
        pushSubject = `Extra payment request reopened - ${propertyName}`;
        pushBody = `Your extra payment request for ${propertyName} was set back to pending for review.${note}`;
        emailSubject = "Extra Payment Request Reopened";
        emailIntro = `<p>Your extra payment request for <strong>${propertyName}</strong> has been set back to <strong>pending</strong> and will be reviewed again.</p>`;
      } else if (isAmountEdit) {
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

    // Notify the cleaner when the underlying request they can see changes
    // (amount/type/hours/rate) without a status change, so their view isn't stale.
    if (isFieldEdit && !isStatusChange && !isAmountEdit && !isReverseToPending) {
      const propertyName = updated.job?.property?.name ?? updated.property?.name ?? "Unlinked request";
      await db.notification.create({
        data: {
          userId: updated.cleaner.id,
          jobId: updated.job?.id ?? undefined,
          channel: NotificationChannel.PUSH,
          subject: `Extra payment request updated - ${propertyName}`,
          body: `An admin updated the details of your extra payment request for ${propertyName}. New requested amount: $${Number(
            updated.requestedAmount ?? 0
          ).toFixed(2)}.`,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });
    }

    const auditAction = isReverseToPending
      ? "REVERSE_PAY_ADJUSTMENT"
      : isStatusChange
      ? "REVIEW_PAY_ADJUSTMENT"
      : isAmountEdit
      ? "EDIT_PAY_ADJUSTMENT_AMOUNT"
      : "EDIT_PAY_ADJUSTMENT";

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: updated.job?.id ?? undefined,
        action: auditAction,
        entity: "CleanerPayAdjustment",
        entityId: updated.id,
        before: {
          status: existing.status,
          approvedAmount: previousApprovedAmount,
          requestedAmount: existing.requestedAmount,
          type: existing.type,
          requestedHours: existing.requestedHours,
          requestedRate: existing.requestedRate,
          jobId: existing.jobId,
          propertyId: existing.propertyId,
          title: existing.title,
          adminNote: existing.adminNote,
        } as any,
        after: {
          status: updated.status,
          approvedAmount: updated.approvedAmount,
          requestedAmount: updated.requestedAmount,
          type: updated.type,
          requestedHours: updated.requestedHours,
          requestedRate: updated.requestedRate,
          jobId: updated.jobId,
          propertyId: updated.propertyId,
          title: updated.title,
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

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const existing = await db.cleanerPayAdjustment.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        jobId: true,
        propertyId: true,
        cleanerId: true,
        status: true,
        type: true,
        title: true,
        requestedAmount: true,
        approvedAmount: true,
        adminNote: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }
    // Approved requests are immutable to deletion — they may already feed payroll.
    if (existing.status === PayAdjustmentStatus.APPROVED) {
      return NextResponse.json(
        {
          error:
            "Approved requests cannot be deleted. Reverse it back to pending first if you need to remove it.",
        },
        { status: 409 }
      );
    }

    // Clean up any linked client-approval records so it disappears from the
    // client portal too (delete everywhere).
    const linkedApprovals = (await listClientApprovals()).filter((approval) => {
      const metadata = approval.metadata as Record<string, unknown> | null;
      return metadata?.source === "pay_adjustment" && metadata?.payAdjustmentId === existing.id;
    });
    const deletedApprovalIds: string[] = [];
    for (const approval of linkedApprovals) {
      if (await deleteClientApprovalById(approval.id)) {
        deletedApprovalIds.push(approval.id);
      }
    }

    await db.cleanerPayAdjustment.delete({ where: { id: params.id } });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: existing.jobId ?? undefined,
        action: "DELETE_PAY_ADJUSTMENT",
        entity: "CleanerPayAdjustment",
        entityId: existing.id,
        before: {
          status: existing.status,
          type: existing.type,
          title: existing.title,
          requestedAmount: existing.requestedAmount,
          approvedAmount: existing.approvedAmount,
          adminNote: existing.adminNote,
          cleanerId: existing.cleanerId,
          deletedClientApprovalIds: deletedApprovalIds,
        } as any,
      },
    });

    return NextResponse.json({ ok: true, deletedClientApprovalIds: deletedApprovalIds });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not delete request." }, { status });
  }
}
