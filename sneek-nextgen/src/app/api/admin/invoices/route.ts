import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  await requireApiRole("ADMIN", "OPS_MANAGER");

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const clientId = searchParams.get("clientId");

  const invoices = await prisma.clientInvoice.findMany({
    where: {
      ...(status && { status: status as never }),
      ...(clientId && { clientId }),
    },
    include: {
      client: { select: { id: true, name: true, email: true } },
      lines: true,
      payments: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return apiSuccess({ invoices, total: invoices.length });
}

export async function POST(req: NextRequest) {
  await requireApiRole("ADMIN", "OPS_MANAGER");

  const body = await req.json();
  const { clientId, periodStart, periodEnd, lines, gstEnabled } = body;

  if (!clientId || !lines?.length) {
    return apiError("clientId and lines are required", 400);
  }

  // Calculate totals
  let subtotal = 0;
  for (const line of lines) {
    line.lineTotal = (line.unitPrice ?? 0) * (line.quantity ?? 1);
    subtotal += line.lineTotal;
  }

  const gstAmount = gstEnabled !== false ? subtotal * 0.1 : 0;
  const totalAmount = subtotal + gstAmount;

  // Generate invoice number
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 9000 + 1000);
  const invoiceNumber = `INV-${year}-${random}`;

  const invoice = await prisma.clientInvoice.create({
    data: {
      clientId,
      invoiceNumber,
      status: "DRAFT",
      periodStart: periodStart ? new Date(periodStart) : null,
      periodEnd: periodEnd ? new Date(periodEnd) : null,
      subtotal,
      gstAmount,
      totalAmount,
      gstEnabled: gstEnabled !== false,
      lines: {
        create: lines.map((line: Record<string, unknown>) => ({
          description: line.description as string,
          quantity: (line.quantity as number) ?? 1,
          unitPrice: (line.unitPrice as number) ?? 0,
          lineTotal: (line.lineTotal as number) ?? 0,
          category: (line.category as string) ?? "JOB",
        })),
      },
    },
    include: {
      client: { select: { id: true, name: true } },
      lines: true,
    },
  });

  return apiSuccess(invoice);
}
