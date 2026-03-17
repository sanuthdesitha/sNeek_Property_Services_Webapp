import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getLaundryInvoiceTemplate, saveLaundryInvoiceTemplate } from "@/lib/laundry/invoice";
import { isLaundryModuleEnabled } from "@/lib/portal-access";

const patchSchema = z.object({
  companyName: z.string().trim().min(1).max(200).optional(),
  invoiceTitle: z.string().trim().min(1).max(200).optional(),
  footerNote: z.string().trim().max(4000).optional(),
});

export async function GET() {
  try {
    const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
    if (session.user.role === Role.LAUNDRY) {
      const settings = await getAppSettings();
      if (!isLaundryModuleEnabled(settings, "invoices")) {
        return NextResponse.json({ error: "Invoices are not available for laundry users." }, { status: 403 });
      }
    }
    const template = await getLaundryInvoiceTemplate(session.user.id);
    return NextResponse.json(template);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
    if (session.user.role === Role.LAUNDRY) {
      const settings = await getAppSettings();
      if (!isLaundryModuleEnabled(settings, "invoices")) {
        return NextResponse.json({ error: "Invoices are not available for laundry users." }, { status: 403 });
      }
    }
    const body = patchSchema.parse(await req.json().catch(() => ({})));
    const template = await saveLaundryInvoiceTemplate(session.user.id, body);
    return NextResponse.json(template);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
