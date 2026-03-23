import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import {
  getShoppingRunBillingContextById,
  updateShoppingRunByAdmin,
  type ShoppingRunAttachment,
  type ShoppingRunPayment,
} from "@/lib/inventory/shopping-runs";

const attachmentSchema = z.object({
  key: z.string().min(1),
  url: z.string().url(),
  name: z.string().min(1).max(160),
  mimeType: z.string().max(120).optional().nullable(),
  sizeBytes: z.number().nonnegative().optional().nullable(),
});

const paymentSchema = z.object({
  method: z
    .enum([
      "COMPANY_CARD",
      "CLIENT_CARD",
      "CLEANER_PERSONAL_CARD",
      "ADMIN_PERSONAL_CARD",
      "CASH",
      "BANK_TRANSFER",
      "OTHER",
    ])
    .optional(),
  paidByScope: z.enum(["COMPANY", "CLIENT", "CLEANER", "ADMIN", "OTHER"]).optional(),
  paidByUserId: z.string().optional().nullable(),
  paidByName: z.string().max(160).optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
  receipts: z.array(attachmentSchema).max(40).optional(),
});

const shoppingTimeSchema = z.object({
  status: z.enum(["NOT_REQUESTED", "PENDING", "APPROVED", "INVOICED", "PAID"]).optional(),
  approvedMinutes: z.number().min(0).max(1440).optional().nullable(),
  approvedRate: z.number().min(0).max(1000).optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
  paidAt: z.string().optional().nullable(),
});

const patchSchema = z.object({
  status: z.enum(["DRAFT", "IN_PROGRESS", "COMPLETED"]).optional(),
  payment: paymentSchema.optional(),
  clientChargeStatus: z.enum(["NOT_REQUIRED", "READY", "SENT", "PAID"]).optional(),
  cleanerReimbursementStatus: z
    .enum(["NOT_APPLICABLE", "READY", "INVOICED", "REIMBURSED"])
    .optional(),
  clientChargeSentAt: z.string().optional().nullable(),
  clientChargePaidAt: z.string().optional().nullable(),
  cleanerReimbursementInvoicedAt: z.string().optional().nullable(),
  cleanerReimbursementPaidAt: z.string().optional().nullable(),
  reimbursementNote: z.string().max(1000).optional().nullable(),
  shoppingTime: shoppingTimeSchema.optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const run = await getShoppingRunBillingContextById(params.id);
    if (!run) {
      return NextResponse.json({ error: "Shopping run not found." }, { status: 404 });
    }
    return NextResponse.json(run);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Request failed." }, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => ({})));
    const payment: Partial<ShoppingRunPayment> | undefined = body.payment
      ? {
          ...body.payment,
          paidByUserId: body.payment.paidByUserId ?? null,
          paidByName: body.payment.paidByName ?? null,
          note: body.payment.note ?? undefined,
          receipts: body.payment.receipts?.map(
            (attachment): ShoppingRunAttachment => ({
              key: attachment.key,
              url: attachment.url,
              name: attachment.name,
              mimeType: attachment.mimeType ?? undefined,
              sizeBytes: attachment.sizeBytes ?? undefined,
            })
          ),
        }
      : undefined;

    const saved = await updateShoppingRunByAdmin({
      id: params.id,
      status: body.status,
      payment,
      clientChargeStatus: body.clientChargeStatus,
      cleanerReimbursementStatus: body.cleanerReimbursementStatus,
      clientChargeSentAt: body.clientChargeSentAt ?? undefined,
      clientChargePaidAt: body.clientChargePaidAt ?? undefined,
      cleanerReimbursementInvoicedAt: body.cleanerReimbursementInvoicedAt ?? undefined,
      cleanerReimbursementPaidAt: body.cleanerReimbursementPaidAt ?? undefined,
      reimbursementNote: body.reimbursementNote ?? undefined,
      shoppingTime: body.shoppingTime
        ? {
            status: body.shoppingTime.status,
            approvedMinutes: body.shoppingTime.approvedMinutes ?? undefined,
            approvedRate: body.shoppingTime.approvedRate ?? undefined,
            note: body.shoppingTime.note ?? undefined,
            paidAt: body.shoppingTime.paidAt ?? undefined,
          }
        : undefined,
    });
    return NextResponse.json(saved);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED"
        ? 401
        : err.message === "FORBIDDEN"
          ? 403
          : err.message === "NOT_FOUND"
            ? 404
            : 400;
    return NextResponse.json({ error: err.message ?? "Update failed." }, { status });
  }
}
