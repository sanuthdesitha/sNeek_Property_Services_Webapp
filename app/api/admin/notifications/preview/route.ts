import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const previewSchema = z.object({
  eventKey: z.string(),
  variables: z.record(z.string().or(z.number()).nullable()).optional(),
});

function substituteVariables(template: string | null | undefined, variables: Record<string, string | number | null | undefined>): string {
  if (!template) return "";
  return template.replace(/\{(\w+)\}/g, (_match, key) => {
    const val = variables[key];
    return val != null ? String(val) : `{${key}}`;
  });
}

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = previewSchema.parse(await req.json());

    const template = await db.notificationTemplate.findUnique({ where: { eventKey: body.eventKey } });
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const sampleVars: Record<string, string | number> = {
      invoiceNumber: "INV-2026-0042",
      clientName: "John Smith",
      totalAmount: "$1,250.00",
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
      gstAmount: "$125.00",
      cleanerName: "Jane Doe",
      title: "Extra hours - deep clean",
      requestedAmount: "$150.00",
      approvedAmount: "$120.00",
      scope: "Additional deep cleaning required",
      type: "Extra Hours",
      adminNote: "Approved for standard rate only",
      payrollRunId: "PR-2026-003",
      cleanerCount: "8",
      grandTotal: "$12,450.00",
      completedAt: "2026-04-15 14:30",
      processedAt: "2026-04-15 15:00",
      amount: "$1,556.25",
      method: "Stripe Connect",
      paidAt: "2026-04-15",
      dueDate: "2026-04-20",
      clientEmail: "john@example.com",
      gatewayProvider: "Stripe",
      error: "Insufficient funds",
      failedCount: "2",
      tenantName: "sNeek Property Services",
      connectedAt: "2026-04-10",
      disconnectedAt: "2026-04-12",
      contactName: "John Smith",
      contactType: "Customer",
      xeroInvoiceId: "INV-XERO-12345",
      xeroBillId: "BILL-XERO-67890",
      xeroContactId: "CONTACT-ABC",
      endpoint: "/api/xero/invoices",
      timestamp: "2026-04-15 10:30",
      payoutCount: "8",
      reviewedAt: "2026-04-14",
      paymentLink: "https://app.sneekops.com.au/pay/abc123",
      refundAmount: "$250.00",
      refundedAt: "2026-04-16",
      failureReason: "Invalid bank account",
      company: "sNeek Property Services",
      date: "2026-04-15",
      time: "14:30",
      ...body.variables,
    };

    const preview = {
      emailSubject: substituteVariables(template.emailSubject, sampleVars),
      emailBodyText: substituteVariables(template.emailBodyText, sampleVars),
      emailBodyHtml: template.emailBodyHtml
        ? substituteVariables(template.emailBodyHtml, sampleVars)
        : substituteVariables(template.emailBodyText, sampleVars).replace(/\n/g, "<br/>"),
      smsBody: substituteVariables(template.smsBody, sampleVars),
      pushTitle: substituteVariables(template.pushTitle, sampleVars),
      pushBody: substituteVariables(template.pushBody, sampleVars),
    };

    return NextResponse.json(preview);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not generate preview." }, { status });
  }
}
