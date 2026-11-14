import { NextRequest, NextResponse } from "next/server";
import { capabilityRefusal } from "@/lib/rbac/capability-http";
import { can } from "@/lib/rbac/can";
import { invoicePatchCapabilities } from "@/lib/rbac/invoice-capabilities";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getClientInvoice, releaseInvoiceConsumables } from "@/lib/billing/client-invoices";
import { returnInvoicedJobsToBillable } from "@/lib/billing/invoice-job-release";
import { db } from "@/lib/db";
import { patchClientInvoice } from "@/lib/billing/client-invoice-patch";
import { loadClientInvoiceEditor } from "@/lib/billing/client-invoice-editor";
import { canManageInvoices } from "@/lib/billing/client-invoice-access";
import { securitySchema, verifyInvoiceSecurity } from "@/lib/billing/client-invoice-patch-rules";
import { isXeroExportPending } from "@/lib/billing/client-invoice-guards";
import { patchVoids, voidCreditSecurityRefusal } from "@/lib/billing/client-invoice-void-guard";
import { REASON_REQUIRED_MESSAGE, requiredReason } from "@/lib/confirmations/reasons";

/** 401/403 for the session guards, like the other invoice routes; 400 otherwise. */
function authStatus(message: string): number {
  if (message === "UNAUTHORIZED") return 401;
  if (message === "FORBIDDEN") return 403;
  return 400;
}

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
      return NextResponse.json({ ...editor, canVoidCredit: await can(session, "invoices.void_credit") });
    }
    const invoice = await getClientInvoice(params.id);
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }
    return NextResponse.json(invoice);
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not load invoice.";
    return NextResponse.json({ error: message }, { status: authStatus(message) });
  }
}

export async function PATCH(req: NextRequest, context: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const refusal = await capabilityRefusal(session, invoicePatchCapabilities(body));
    if (refusal) return refusal;
    // The action (row lock, guards, audit) lives in lib so the bulk route runs
    // exactly the same checks.
    const actor = { ...session.user, impersonatedBy: session.impersonation?.actorId ?? null };
    // Voiding (an invoice or a credit note) is a sensitive action (owner
    // decision 2026-11-13): the acting person's own PIN, checked here.
    if (patchVoids(body)) {
      // A void keeps its reason in the invoice history (quick pick; no minimum length).
      if (!requiredReason((body as { voidReason?: unknown }).voidReason)) {
        return NextResponse.json({ error: REASON_REQUIRED_MESSAGE, code: "REASON_REQUIRED" }, { status: 400 });
      }
      const pinRefusal = await voidCreditSecurityRefusal(actor, body);
      if (pinRefusal) return NextResponse.json(pinRefusal.body, { status: pinRefusal.status });
    }
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
          isXeroExportPending(invoice.metadata)) {
        throw new Error("Only an unpaid, unexported draft may be deleted. Use a reconciled correction for issued invoices.");
      }
      await releaseInvoiceConsumables(tx, invoice.id);
      // Jobs marked INVOICED only because of this draft return to billable.
      await returnInvoicedJobsToBillable(tx, {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        reason: "deleted",
        actorId: session.user.id,
      });
      await tx.clientInvoice.delete({ where: { id: params.id } });
    });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not delete invoice.";
    return NextResponse.json({ error: message }, { status: authStatus(message) });
  }
}
