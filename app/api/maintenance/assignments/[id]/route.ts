import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * What an assignee can do with work they have been given.
 *
 * Until now this row was write-only from the office's side: an admin assigned
 * it, an email went out, and the person on the other end had a list they could
 * read and nothing they could press. An assignment nobody can accept is
 * indistinguishable from one nobody has seen.
 *
 * SCOPED TO THE CALLER'S OWN ROW, always. An assignment id is not authority —
 * every action re-checks that this session owns that assignment, so knowing an
 * id gets you nothing.
 *
 * DECLINE DOES NOT DELETE. The row is stamped with a reason and stays. A
 * declined job that vanished would leave an admin believing it was still
 * covered, which is the one outcome worse than it not being covered at all.
 */

const bodySchema = z.object({
  action: z.enum(["ACCEPT", "DECLINE", "COMPLETE", "REQUEST_PAY_CHANGE"]),
  note: z.string().trim().max(4000).optional(),
  photoKeys: z.array(z.string().trim().min(1).max(512)).max(20).optional(),
  /** REQUEST_PAY_CHANGE only. */
  amount: z.number().min(0).max(1_000_000).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();
    const body = bodySchema.parse(await req.json().catch(() => ({})));

    const assignment = await db.maintenanceItemAssignment.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        userId: true,
        removedAt: true,
        acceptedAt: true,
        completedAt: true,
        payAmount: true,
        item: { select: { id: true, title: true, property: { select: { name: true } } } },
      },
    });

    // Same answer for "does not exist" and "is not yours": distinguishing them
    // would confirm that a guessed id is real.
    if (!assignment || assignment.userId !== session.user.id) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }
    if (assignment.removedAt) {
      return NextResponse.json(
        { error: "You are no longer assigned to this item." },
        { status: 409 }
      );
    }

    const now = new Date();
    const actorName = session.user.name ?? "A team member";
    const propertyName = assignment.item.property?.name ?? "a property";

    if (body.action === "ACCEPT") {
      if (assignment.completedAt) {
        return NextResponse.json({ error: "That work is already done." }, { status: 409 });
      }
      await db.maintenanceItemAssignment.update({
        where: { id: assignment.id },
        // Clearing declinedAt matters: someone who declined and then changed
        // their mind must not stay listed as having refused.
        data: { acceptedAt: now, declinedAt: null, declineReason: null },
      });
      return NextResponse.json({ ok: true, acceptedAt: now });
    }

    if (body.action === "DECLINE") {
      await db.maintenanceItemAssignment.update({
        where: { id: assignment.id },
        data: { declinedAt: now, acceptedAt: null, declineReason: body.note?.trim() || null },
      });
      // The office has to find out, quickly — a declined job nobody is told
      // about is a job that silently does not happen.
      await notifyOffice({
        subject: `Maintenance declined — ${assignment.item.title}`,
        body: `${actorName} declined ${assignment.item.title} at ${propertyName}.${
          body.note?.trim() ? ` Reason: ${body.note.trim()}` : ""
        }`,
      });
      return NextResponse.json({ ok: true, declinedAt: now });
    }

    if (body.action === "COMPLETE") {
      if (!assignment.acceptedAt) {
        // Completing something never accepted is usually a mis-tap on the wrong
        // row. Accepting implicitly would hide that.
        return NextResponse.json(
          { error: "Accept the job before marking it done." },
          { status: 409 }
        );
      }
      await db.maintenanceItemAssignment.update({
        where: { id: assignment.id },
        data: {
          completedAt: now,
          completionNote: body.note?.trim() || null,
          ...(body.photoKeys?.length ? { completionPhotoKeys: body.photoKeys } : {}),
        },
      });
      await notifyOffice({
        subject: `Maintenance completed — ${assignment.item.title}`,
        body: `${actorName} finished ${assignment.item.title} at ${propertyName}.${
          body.note?.trim() ? ` Note: ${body.note.trim()}` : ""
        }`,
      });
      return NextResponse.json({ ok: true, completedAt: now });
    }

    // REQUEST_PAY_CHANGE
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Enter the amount you think it should be." },
        { status: 400 }
      );
    }
    await db.maintenanceItemAssignment.update({
      where: { id: assignment.id },
      data: {
        payChangeAmount: amount,
        payChangeReason: body.note?.trim() || null,
        // PENDING, never applied here. The assignee proposes and an admin
        // decides — letting this write payAmount would let anyone set their fee.
        payChangeStatus: "PENDING",
        payChangeAt: now,
      },
    });
    await notifyOffice({
      subject: `Price change requested — ${assignment.item.title}`,
      body: `${actorName} asked for $${amount.toFixed(2)} on ${assignment.item.title} (currently ${
        assignment.payAmount != null ? `$${assignment.payAmount.toFixed(2)}` : "unpriced"
      }).${body.note?.trim() ? ` Reason: ${body.note.trim()}` : ""}`,
    });

    return NextResponse.json({ ok: true, payChangeStatus: "PENDING" });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: "Could not update that assignment." }, { status });
  }
}

/**
 * Tell the office. Never allowed to fail the action — the assignment change is
 * already written, and a mail server having a bad afternoon must not tell
 * somebody their completed job did not save.
 */
async function notifyOffice(input: { subject: string; body: string }) {
  try {
    const { Role } = await import("@prisma/client");
    const admins = await db.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
      select: { id: true },
    });
    if (admins.length === 0) return;
    await db.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        channel: "PUSH" as const,
        subject: input.subject,
        body: input.body,
        status: "SENT" as const,
        sentAt: new Date(),
      })),
    });
  } catch (err) {
    logger.error({ err }, "[maintenance] assignment notification failed");
  }
}
