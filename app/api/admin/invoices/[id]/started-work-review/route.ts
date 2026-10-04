import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { loadStartedWorkReview } from "@/lib/billing/started-work-reconciliation";
import { calculateShoppingAwareInvoiceTotals } from "@/lib/billing/shopping-client-charges";
const schema = z.object({ action: z.enum(["REFRESH", "CONFIRM"]), expectedUpdatedAt: z.string().datetime(), evidenceNote: z.string().trim().min(10).max(2000).optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json());
    if (body.action === "CONFIRM" && !body.evidenceNote) return NextResponse.json({ error: "Record the evidence and pricing decision before confirming review." }, { status: 400 });
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "ClientInvoice" WHERE "id" = ${params.id} FOR UPDATE`;
      const invoice = await tx.clientInvoice.findUnique({ where: { id: params.id }, include: { lines: true } });
      if (!invoice || invoice.status !== "DRAFT" || invoice.xeroInvoiceId || invoice.xeroExportedAt || invoice.paidAt || Number(invoice.paidAmount ?? 0) > 0 || (invoice.metadata as any)?.xeroExportState === "PENDING") {
        throw new Error("Only an unpaid, unexported draft can be reconciled. Approved or issued invoices need a manual correction.");
      }
      if (invoice.updatedAt.toISOString() !== body.expectedUpdatedAt) throw new Error("The invoice changed. Reload it before reviewing.");
      const ids = Array.from(new Set(invoice.lines.flatMap(line => line.jobId ? [line.jobId] : []))).sort();
      for (const id of ids) await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${id} FOR UPDATE`;
      const state = await loadStartedWorkReview(invoice, tx);
      if (!state) throw new Error("This invoice has no started-work review snapshot.");
      if (body.action === "CONFIRM" && state.changedJobIds.length) throw new Error("Jobs or billing changed. Refresh the draft amounts and inspect them before confirming.");
      let totals = {};
      if (body.action === "REFRESH") {
        for (const line of invoice.lines) {
          if (!line.jobId) continue;
          const job = state.current.find(row => row.jobId === line.jobId)!;
          await tx.clientInvoiceLine.update({ where: { id: line.id }, data: { quantity: 1, unitPrice: job.agreedAmount, lineTotal: job.agreedAmount, note: job.invoiceNote } });
        }
        const lines = invoice.lines.map(line => {
          const job = state.current.find(row => row.jobId === line.jobId);
          return job ? { ...line, lineTotal: job.agreedAmount } : line;
        });
        totals = calculateShoppingAwareInvoiceTotals(lines, invoice.gstEnabled ?? true);
      }
      if (body.action === "CONFIRM") {
        for (const line of invoice.lines) {
          if (line.note?.includes("office review required.")) await tx.clientInvoiceLine.update({ where: { id: line.id }, data: { note: line.note.replace("office review required.", "office-reviewed provisional estimate.") } });
        }
      }
      const review = {
        ...state.review, jobs: state.current.map(({ invoiceNote, ...job }) => job),
        required: body.action === "REFRESH",
        reviewedAt: body.action === "CONFIRM" ? new Date().toISOString() : null,
        reviewedById: body.action === "CONFIRM" ? actor.user.id : null,
        evidenceNote: body.action === "CONFIRM" ? body.evidenceNote : null,
      };
      await tx.clientInvoice.update({ where: { id: invoice.id }, data: { ...totals, metadata: { ...(invoice.metadata as object ?? {}), startedWorkReview: review } } });
      await tx.auditLog.create({ data: { userId: actor.user.id, action: body.action === "REFRESH" ? "STARTED_WORK_DRAFT_REFRESHED" : "STARTED_WORK_REVIEW_CONFIRMED", entity: "ClientInvoice", entityId: invoice.id, before: { review: state.review } as any, after: { review } as any } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reconcile draft.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 409 });
  }
}
