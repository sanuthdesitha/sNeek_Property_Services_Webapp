import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getLaundryInvoiceData, getLaundryInvoiceTemplate, LaundryInvoicePeriod } from "@/lib/laundry/invoice";
import { isLaundryModuleEnabled } from "@/lib/portal-access";
import { logLaundryReportActivity } from "@/lib/laundry/report-history";

const querySchema = z.object({
  period: z.enum(["daily", "weekly", "monthly", "annual", "custom"]).optional(),
  anchorDate: z.string().date().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  propertyId: z.string().trim().min(1).optional(),
  taskId: z.string().trim().min(1).optional(),
  includePending: z.coerce.boolean().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
    if (session.user.role === Role.LAUNDRY) {
      const settings = await getAppSettings();
      if (!isLaundryModuleEnabled(settings, "invoices")) {
        return NextResponse.json({ error: "Invoices are not available for laundry users." }, { status: 403 });
      }
    }
    const { searchParams } = new URL(req.url);
    const params = querySchema.parse({
      period: searchParams.get("period") ?? undefined,
      anchorDate: searchParams.get("anchorDate") ?? undefined,
      startDate: searchParams.get("startDate") ?? undefined,
      endDate: searchParams.get("endDate") ?? undefined,
      propertyId: searchParams.get("propertyId") ?? undefined,
      taskId: searchParams.get("taskId") ?? undefined,
      includePending: searchParams.get("includePending") ?? undefined,
    });

    const [data, template] = await Promise.all([
      getLaundryInvoiceData({
        period: params.period as LaundryInvoicePeriod | undefined,
        anchorDate: params.anchorDate,
        startDate: params.startDate,
        endDate: params.endDate,
        propertyId: params.propertyId,
        taskId: params.taskId,
        includePending: params.includePending,
      }),
      getLaundryInvoiceTemplate(session.user.id),
    ]);
    await logLaundryReportActivity({
      userId: session.user.id,
      action: "PREVIEW",
      data,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
    return NextResponse.json({ data, template });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
