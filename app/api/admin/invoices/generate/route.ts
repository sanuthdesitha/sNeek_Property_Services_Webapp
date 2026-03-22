import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { generateClientInvoice } from "@/lib/billing/client-invoices";

const schema = z.object({
  clientId: z.string().trim().min(1),
  propertyId: z.string().trim().optional().nullable(),
  periodStart: z.string().trim().optional().nullable(),
  periodEnd: z.string().trim().optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    return NextResponse.json(
      await generateClientInvoice({
        clientId: body.clientId,
        propertyId: body.propertyId || null,
        periodStart: body.periodStart ? new Date(body.periodStart) : null,
        periodEnd: body.periodEnd ? new Date(body.periodEnd) : null,
      })
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not generate invoice." }, { status: 400 });
  }
}
