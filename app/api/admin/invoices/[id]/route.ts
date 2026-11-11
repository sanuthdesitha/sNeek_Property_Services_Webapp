import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getClientInvoice, releaseInvoiceConsumables } from "@/lib/billing/client-invoices";
import { db } from "@/lib/db";
import { patchClientInvoice } from "@/lib/billing/client-invoice-patch";
import { loadClientInvoiceEditor } from "@/lib/billing/client-invoice-editor";
import { canManageInvoices } from "@/lib/billing/client-invoice-access";
import { securitySchema, verifyInvoiceSecurity } from "@/lib/billing/client-invoice-patch-rules";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    // ?view=editor → the editor page's read model (lines, checks, Xero, history).
    if (req.nextUrl.searchParams.get("view") === "editor") {
      const canManage = await canManageInvoices(session.user, params.id);
      const editor = await loadClientInvoiceEditor(params.id, { canManage });
      if (!editor) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
      return NextResponse.json(editor);
    }
    const invoice = await getClientInvoice(params.id);
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }
    return NextResponse.json(invoice);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load invoice." }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest, context: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    // The action (row lock, guards, audit) lives in lib so the bulk route runs
    // exactly the same checks.
    const actor = { ...session.user, impersonatedBy: session.impersonation?.actorId ?? null };
    const result = await patchClientInvoice({ invoiceId: context.params.id, body, actor });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update invoice.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 409 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    // The PIN or password is verified HERE, not only in the browser.
    const body = await req.json().catch(() => ({}));
    const security = securitySchema.safeParse((body as { security?: unknown })?.security);
    const refusal = await verifyInvoiceSecurity(
      { ...session.user, impersonatedBy: session.impersonation?.actorId ?? null },
      security.success ? security.data : undefined,
    );
    if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "ClientInvoice" WHERE "id" = ${params.id} FOR UPDATE`;
      const invoice = await tx.clientInvoice.findUnique({ where: { id: params.id } });
      if (!invoice || invoice.status !== "DRAFT" || invoice.xeroInvoiceId || invoice.paidAt || Number(invoice.paidAmount ?? 0) > 0 ||
          (invoice.metadata as Record<string, unknown> | null)?.xeroExportState === "PENDING") {
        throw new Error("Only an unpaid, unexported draft may be deleted. Use a reconciled correction for issued invoices.");
      }
      await releaseInvoiceConsumables(tx, invoice.id);
      await tx.clientInvoice.delete({ where: { id: params.id } });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not delete invoice." }, { status: 400 });
  }
}
