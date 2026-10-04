import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { releaseCleanerInvoiceConsumables } from "@/lib/cleaner/invoice-release";
const schema = z.object({ resolution: z.enum(["CONFIRMED_SENT", "CONFIRMED_NOT_SENT"]), evidenceNote: z.string().trim().min(10).max(2000) });
/** Human reconciliation only. Never attempts external delivery or a refund. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json());
    const invoice = await db.cleanerInvoiceSubmission.findUnique({ where: { id: params.id }, select: { cleanerId: true } });
    if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    const status = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoice.cleanerId}))`;
      await tx.$queryRaw`SELECT "id" FROM "CleanerInvoiceSubmission" WHERE "id" = ${params.id} FOR UPDATE`;
      const current = await tx.cleanerInvoiceSubmission.findUnique({ where: { id: params.id } });
      if (!current || current.status !== "SENDING" || current.xeroBillId || current.paidAt || current.paidAmount != null) {
        throw new Error("Only an unpaid, unexported invoice awaiting delivery review can be resolved.");
      }
      const delivery = (current.lineData as Record<string, unknown> | null)?.delivery;
      if (delivery !== "REVIEW_REQUIRED" && current.createdAt.getTime() > Date.now() - 10 * 60_000) {
        throw new Error("Delivery may still be in progress. Wait for its result or ten minutes before reviewing an interrupted attempt.");
      }
      const next = body.resolution === "CONFIRMED_SENT" ? "SUBMITTED" : "VOID";
      if (next === "VOID") await releaseCleanerInvoiceConsumables(tx, current.id);
      const snapshot = current.lineData && typeof current.lineData === "object" && !Array.isArray(current.lineData) ? current.lineData : {};
      await tx.cleanerInvoiceSubmission.update({ where: { id: current.id }, data: { status: next,
        lineData: { ...snapshot, delivery: body.resolution, deliveryReviewedById: actor.user.id, deliveryReviewedAt: new Date().toISOString(), deliveryEvidenceNote: body.evidenceNote } } });
      await tx.auditLog.create({ data: { userId: actor.user.id, action: "CLEANER_INVOICE_DELIVERY_REVIEWED", entity: "CleanerInvoiceSubmission", entityId: current.id,
        before: { status: current.status }, after: { status: next, resolution: body.resolution, evidenceNote: body.evidenceNote } } });
      return next;
    });
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delivery review failed.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 409 });
  }
}
