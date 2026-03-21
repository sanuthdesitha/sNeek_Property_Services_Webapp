import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  buildShoppingRunClientReimbursementHtml,
  getShoppingRunBillingContextById,
  renderShoppingRunPdf,
  updateShoppingRunByAdmin,
} from "@/lib/inventory/shopping-runs";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";

const schema = z.object({
  to: z.union([z.string().trim().email(), z.array(z.string().trim().email()).min(1)]),
  clientId: z.string().optional().nullable(),
  subject: z.string().trim().max(200).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const run = await getShoppingRunBillingContextById(params.id);
    if (!run) {
      return NextResponse.json({ error: "Shopping run not found." }, { status: 404 });
    }

    const allocation =
      run.clientAllocations.find((row) => row.clientId === (body.clientId ?? null)) ??
      (body.clientId ? null : run.clientAllocations[0] ?? null);
    if (!allocation) {
      return NextResponse.json({ error: "Client allocation not found." }, { status: 404 });
    }

    const settings = await getAppSettings();
    const html = buildShoppingRunClientReimbursementHtml({
      companyName: settings.companyName,
      logoUrl: settings.logoUrl,
      run,
      clientAllocation: allocation,
    });
    let pdf: Buffer;
    try {
      pdf = await renderShoppingRunPdf(html);
    } catch {
      return NextResponse.json(
        { error: "PDF generation failed. Ensure Playwright browsers are installed." },
        { status: 500 }
      );
    }

    const receiptAttachments = [];
    for (const receipt of run.payment.receipts) {
      try {
        const response = await fetch(receipt.url);
        if (!response.ok) continue;
        const arrayBuffer = await response.arrayBuffer();
        receiptAttachments.push({
          filename: receipt.name || receipt.key.split("/").pop() || "receipt",
          content: Buffer.from(arrayBuffer),
        });
      } catch {}
    }

    const to = Array.isArray(body.to) ? body.to : [body.to];
    const subject =
      body.subject?.trim() ||
      `Shopping reimbursement - ${allocation.clientName} - ${run.name}`;
    const emailResult = await sendEmailDetailed({
      to,
      subject,
      html: `
        <p>Please find the attached shopping reimbursement summary for <strong>${allocation.clientName}</strong>.</p>
        <p><strong>Run:</strong> ${run.name}</p>
        <p><strong>Amount due:</strong> $${allocation.actualAmount.toFixed(2)}</p>
        <p><strong>Receipts attached:</strong> ${run.payment.receipts.length}</p>
      `,
      attachments: [
        {
          filename: `shopping-reimbursement-${run.id}.pdf`,
          content: pdf,
        },
        ...receiptAttachments,
      ],
    });

    await db.notification.create({
      data: {
        channel: NotificationChannel.EMAIL,
        subject,
        body: `Shopping reimbursement email for run ${run.id} sent to ${to.join(", ")}`,
        status: emailResult.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
        sentAt: emailResult.ok ? new Date() : undefined,
        errorMsg: emailResult.ok ? undefined : emailResult.error ?? "Email provider failed.",
      },
    });

    if (!emailResult.ok) {
      return NextResponse.json(
        { error: emailResult.error ?? "Email provider failed to send reimbursement pack." },
        { status: 502 }
      );
    }

    await updateShoppingRunByAdmin({
      id: run.id,
      clientChargeStatus: allocation.requiresClientCharge ? "SENT" : run.clientChargeStatus,
      clientChargeSentAt: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Email failed." }, { status });
  }
}
