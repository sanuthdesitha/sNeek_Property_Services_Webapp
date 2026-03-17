import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import {
  buildCleanerInvoiceHtml,
  getCleanerInvoiceData,
  renderCleanerInvoicePdf,
} from "@/lib/cleaner/invoice";

const schema = z.object({
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  showSpentHours: z.boolean().optional(),
  jobComments: z.record(z.string(), z.string()).optional(),
  jobHourOverrides: z.record(z.string(), z.number().nonnegative()).optional(),
});

async function buildInvoicePdfResponse(input: {
  userId: string;
  startDate?: string;
  endDate?: string;
  showSpentHours?: boolean;
  jobComments?: Record<string, string>;
  jobHourOverrides?: Record<string, number>;
}) {
  const data = await getCleanerInvoiceData(input);
  const html = buildCleanerInvoiceHtml(data);
  const pdf = await renderCleanerInvoicePdf(html);
  const fileName = `cleaner-invoice-${data.start.toISOString().slice(0, 10)}-to-${data.end
    .toISOString()
    .slice(0, 10)}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename=\"${fileName}\"`,
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const settings = await getAppSettings();
    if (!isCleanerModuleEnabled(settings, "invoices")) {
      return NextResponse.json({ error: "Invoices are disabled for cleaners." }, { status: 403 });
    }
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate") ?? undefined;
    const endDate = searchParams.get("endDate") ?? undefined;
    const showSpentHours = searchParams.get("showSpentHours") === "true";

    return buildInvoicePdfResponse({
      userId: session.user.id,
      startDate,
      endDate,
      showSpentHours,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const settings = await getAppSettings();
    if (!isCleanerModuleEnabled(settings, "invoices")) {
      return NextResponse.json({ error: "Invoices are disabled for cleaners." }, { status: 403 });
    }
    const body = schema.parse(await req.json().catch(() => ({})));
    return buildInvoicePdfResponse({
      userId: session.user.id,
      startDate: body.startDate,
      endDate: body.endDate,
      showSpentHours: body.showSpentHours,
      jobComments: body.jobComments,
      jobHourOverrides: body.jobHourOverrides,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
