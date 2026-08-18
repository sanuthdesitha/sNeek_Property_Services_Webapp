import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { generateClientInvoice } from "@/lib/billing/client-invoices";
import { sydneyDayBoundary } from "@/lib/billing/period";

const schema = z.object({
  clientId: z.string().trim().min(1),
  propertyId: z.string().trim().optional().nullable(),
  periodStart: z.string().trim().optional().nullable(),
  periodEnd: z.string().trim().optional().nullable(),
  gstEnabled: z.boolean().optional(),
  // Which date the period is measured against - see InvoicePeriodBasis.
  periodBasis: z.enum(["SERVICE", "SCHEDULED"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    return NextResponse.json(
      await generateClientInvoice({
        clientId: body.clientId,
        propertyId: body.propertyId || null,
        periodStart: sydneyDayBoundary(body.periodStart, "start"),
        periodEnd: sydneyDayBoundary(body.periodEnd, "end"),
        gstEnabled: body.gstEnabled,
        periodBasis: body.periodBasis,
      })
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not generate invoice." }, { status: 400 });
  }
}
