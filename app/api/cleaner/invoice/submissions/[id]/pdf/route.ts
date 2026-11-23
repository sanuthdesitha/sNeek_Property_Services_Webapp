import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { renderCleanerInvoicePdf } from "@/lib/cleaner/invoice";
import { buildSubmittedInvoiceHtml } from "@/lib/cleaner/invoice-snapshot-pdf";
import { latestSnapshotAmendment, loadAmendmentHistory } from "@/lib/cleaner/invoice-amend-history";
import { invoiceErrorMessage, invoiceErrorStatus, requireInvoicePayeeSession } from "@/lib/invoicing/access";

export const dynamic = "force-dynamic";

/**
 * The payee's own submitted invoice as a PDF, as it stands now: amended by the
 * office or as submitted (2026-11-23; the link in the amendment notice). Built
 * from the stored snapshot by the same renderer as the office copy. Scoped to
 * `session.user.id`: another payee's id answers 404, exactly as "not found".
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireInvoicePayeeSession();
    const submission = await db.cleanerInvoiceSubmission.findUnique({ where: { id: params.id } });
    if (!submission || submission.cleanerId !== session.user.id) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    const [settings, history] = await Promise.all([
      getAppSettings(),
      submission.amendmentCount > 0 ? loadAmendmentHistory(submission.id) : Promise.resolve(null),
    ]);
    const html = buildSubmittedInvoiceHtml(submission, session.user.name || session.user.email || "Payee", settings.companyName, latestSnapshotAmendment(history));
    const pdf = await renderCleanerInvoicePdf(html);
    const inline = new URL(req.url).searchParams.get("inline") === "1";
    const fileName = `${(submission.invoiceNumber ?? `invoice-${submission.id}`).replace(/[^A-Za-z0-9._-]/g, "_")}${submission.amendmentCount > 0 ? "-amended" : ""}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${fileName}"`, "Cache-Control": "private, no-store" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : undefined;
    return NextResponse.json({ error: invoiceErrorMessage(message) }, { status: invoiceErrorStatus(message) });
  }
}
