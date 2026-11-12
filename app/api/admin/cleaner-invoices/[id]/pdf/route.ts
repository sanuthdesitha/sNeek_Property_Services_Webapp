import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { renderCleanerInvoicePdf } from "@/lib/cleaner/invoice";
import { buildSubmittedInvoiceHtml } from "@/lib/cleaner/invoice-snapshot-pdf";

export const dynamic = "force-dynamic";

/**
 * The office copy of one submitted payee invoice as a PDF, behind the same
 * admin guard as the list (ADMIN, or OPS_MANAGER with the payroll pack via
 * middleware). Built from this submission's snapshot only.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const submission = await db.cleanerInvoiceSubmission.findUnique({ where: { id: params.id } });
    if (!submission) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    const [payee, settings] = await Promise.all([
      db.user.findUnique({ where: { id: submission.cleanerId }, select: { name: true, email: true } }),
      getAppSettings(),
    ]);
    const html = buildSubmittedInvoiceHtml(submission, payee?.name || payee?.email || "Payee", settings.companyName);
    const pdf = await renderCleanerInvoicePdf(html);
    const inline = new URL(req.url).searchParams.get("inline") === "1";
    const fileName = `${(submission.invoiceNumber ?? `payee-invoice-${submission.id}`).replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${fileName}"` },
    });
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not create the PDF.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
