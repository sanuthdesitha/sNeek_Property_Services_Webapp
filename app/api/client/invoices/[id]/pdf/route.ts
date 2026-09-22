import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { requireClientPortal } from "@/lib/auth/client-portal";
import { db } from "@/lib/db";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { isClientModuleEnabled } from "@/lib/portal-access";
import { getClientInvoice, renderClientInvoicePdf } from "@/lib/billing/client-invoices";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const issued = (status: string) => ["APPROVED", "SENT", "PART_PAID", "PAID"].includes(status);
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.CLIENT]);
    const portal = await requireClientPortal({ permission: "invoicesView" });
    if (portal.actor !== "CLIENT" || !isClientModuleEnabled(portal.visibility, "finance")) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
    if (portal.settings === DEFAULT_SETTINGS && await db.appSetting.findUnique({ where: { key: "app" }, select: { key: true } })) throw new Error("Invoice visibility unavailable");
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(params.id)) return NextResponse.json({ error: "Invoice not found." }, { status: 404, headers });
    // Verify ownership before loading any invoice lines or invoking the PDF renderer.
    const allowed = await db.clientInvoice.findFirst({ where: { id: params.id, clientId: portal.clientId, status: { in: ["APPROVED", "SENT", "PART_PAID", "PAID"] } }, select: { id: true } });
    if (!allowed) return NextResponse.json({ error: "Invoice not found." }, { status: 404, headers });
    const invoice = await getClientInvoice(allowed.id);
    if (!invoice || invoice.clientId !== portal.clientId || !issued(invoice.status)) return NextResponse.json({ error: "Invoice not found." }, { status: 404, headers });
    const settings = portal.settings;
    const pdf = await renderClientInvoicePdf(invoice, settings.companyName || "sNeek Property Services", settings.logoUrl || settings.reportLogoUrl, settings.invoicing);
    const filename = invoice.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "invoice";
    return new NextResponse(new Uint8Array(pdf), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}.pdf"` } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 503;
    return NextResponse.json({ error: status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Invoice PDF could not be generated. Try again." }, { status, headers });
  }
}
