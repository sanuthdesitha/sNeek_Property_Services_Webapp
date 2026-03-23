import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import { notifyShoppingRunSubmitted } from "@/lib/inventory/notifications";
import {
  listShoppingRunsForOwner,
  saveShoppingRunForOwner,
  type ShoppingRunAttachment,
  type ShoppingRunPayment,
  type ShoppingRunRow,
  type ShoppingRunStatus,
} from "@/lib/inventory/shopping-runs";

const attachmentSchema = z.object({
  key: z.string().min(1),
  url: z.string().url(),
  name: z.string().min(1).max(160),
  mimeType: z.string().max(120).optional().nullable(),
  sizeBytes: z.number().nonnegative().optional().nullable(),
});

const paymentSchema = z.object({
  method: z.enum([
    "COMPANY_CARD",
    "CLIENT_CARD",
    "CLEANER_PERSONAL_CARD",
    "ADMIN_PERSONAL_CARD",
    "CASH",
    "BANK_TRANSFER",
    "OTHER",
  ]),
  paidByScope: z.enum(["COMPANY", "CLIENT", "CLEANER", "ADMIN", "OTHER"]),
  paidByUserId: z.string().optional().nullable(),
  paidByName: z.string().max(160).optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
  receipts: z.array(attachmentSchema).max(40).optional().default([]),
});

const shoppingTimeSchema = z.object({
  requestedMinutes: z.number().min(0).max(1440).optional(),
  note: z.string().max(1000).optional().nullable(),
});

const rowSchema = z.object({
  propertyId: z.string().min(1),
  propertyName: z.string().min(1),
  suburb: z.string().optional().default(""),
  itemId: z.string().min(1),
  itemName: z.string().min(1),
  category: z.string().min(1),
  supplier: z.string().nullable().optional(),
  unit: z.string().min(1),
  onHand: z.number(),
  parLevel: z.number(),
  reorderThreshold: z.number(),
  needed: z.number().min(0),
  plannedQty: z.number().min(0),
  include: z.boolean(),
  purchased: z.boolean(),
  actualPurchasedQty: z.number().min(0).optional().default(0),
  actualUnitCost: z.number().min(0).nullable().optional(),
  actualLineCost: z.number().min(0).nullable().optional(),
  checkedAt: z.string().optional().nullable(),
  note: z.string().max(500).optional().nullable(),
  priority: z.enum(["Emergency", "High", "Medium"]).optional(),
  estimatedUnitCost: z.number().min(0).nullable().optional(),
  estimatedLineCost: z.number().min(0).nullable().optional(),
});

const saveSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  status: z.enum(["DRAFT", "IN_PROGRESS", "COMPLETED"]),
  planningScope: z.string().min(1),
  rows: z.array(rowSchema).max(5000),
  payment: paymentSchema.optional(),
  startedAt: z.string().optional().nullable(),
  completedAt: z.string().optional().nullable(),
  reimbursementNote: z.string().max(1000).optional().nullable(),
  shoppingTime: shoppingTimeSchema.optional(),
});

export async function GET() {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    if (session.user.role === Role.CLEANER) {
      const settings = await getAppSettings();
      if (!isCleanerModuleEnabled(settings, "shopping")) {
        return NextResponse.json({ error: "Shopping is not available for cleaners." }, { status: 403 });
      }
    }
    const runs = await listShoppingRunsForOwner({
      ownerScope: "CLEANER",
      ownerUserId: session.user.id,
    });
    return NextResponse.json(runs);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Request failed." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    if (session.user.role === Role.CLEANER) {
      const settings = await getAppSettings();
      if (!isCleanerModuleEnabled(settings, "shopping")) {
        return NextResponse.json({ error: "Shopping is not available for cleaners." }, { status: 403 });
      }
    }
    const body = saveSchema.parse(await req.json());
    const rows: ShoppingRunRow[] = body.rows.map((row) => ({
      ...row,
      suburb: row.suburb ?? "",
      supplier: row.supplier ?? null,
      actualPurchasedQty: row.actualPurchasedQty ?? 0,
      actualUnitCost: row.actualUnitCost ?? null,
      actualLineCost: row.actualLineCost ?? null,
      checkedAt: row.checkedAt ?? undefined,
      note: row.note ?? undefined,
      estimatedUnitCost: row.estimatedUnitCost ?? null,
      estimatedLineCost: row.estimatedLineCost ?? null,
    }));
    const payment: ShoppingRunPayment | undefined = body.payment
      ? {
          ...body.payment,
          paidByUserId: body.payment.paidByUserId ?? null,
          paidByName: body.payment.paidByName ?? null,
          note: body.payment.note ?? undefined,
          receipts: (body.payment.receipts ?? []).map(
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
    const saved = await saveShoppingRunForOwner({
      id: body.id,
      name: body.name.trim(),
      status: body.status as ShoppingRunStatus,
      ownerScope: "CLEANER",
      ownerUserId: session.user.id,
      planningScope: body.planningScope,
      rows,
      payment,
      startedAt: body.startedAt ?? undefined,
      completedAt: body.completedAt ?? undefined,
      reimbursementNote: body.reimbursementNote ?? undefined,
      shoppingTime: body.shoppingTime
        ? {
            requestedMinutes: body.shoppingTime.requestedMinutes,
            note: body.shoppingTime.note ?? undefined,
          }
        : undefined,
    });
    if (body.status === "COMPLETED") {
      await notifyShoppingRunSubmitted({
        run: saved,
        actorLabel: session.user.name || session.user.email || "Cleaner",
      });
    }
    return NextResponse.json(saved, { status: body.id ? 200 : 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Save failed." }, { status });
  }
}
