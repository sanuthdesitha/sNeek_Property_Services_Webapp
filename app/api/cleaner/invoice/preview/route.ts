import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCleanerInvoiceData } from "@/lib/cleaner/invoice";
import {
  invoiceErrorMessage,
  invoiceErrorStatus,
  requireInvoicePayeeSession,
} from "@/lib/invoicing/access";

// Payee = session.user.id, always. Never a caller-supplied id, which is what
// makes it safe for this route to serve QA inspectors as well as cleaners.

const schema = z.object({
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  showSpentHours: z.boolean().optional(),
  // The download and send routes have always accepted this; the preview did
  // not, so hiding hours produced a PDF that disagreed with the preview the
  // payee had just approved.
  showHours: z.boolean().optional(),
  jobComments: z.record(z.string(), z.string()).optional(),
  jobHourOverrides: z.record(z.string(), z.number().nonnegative()).optional(),
  excludedJobIds: z.array(z.string().min(1)).max(500).optional(),
  excludedRunIds: z.array(z.string().min(1)).max(500).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireInvoicePayeeSession();
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate") ?? undefined;
    const endDate = searchParams.get("endDate") ?? undefined;
    const showSpentHours = searchParams.get("showSpentHours") === "true";
    // Hours are shown unless explicitly turned off — same convention as the
    // download route, so the preview and the PDF agree.
    const showHours = searchParams.get("showHours") !== "false";

    const data = await getCleanerInvoiceData({
      userId: session.user.id,
      startDate,
      endDate,
      showSpentHours,
      showHours,
      excludeInvoicedJobs: true,
    });

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: invoiceErrorMessage(err?.message) },
      { status: invoiceErrorStatus(err?.message) }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireInvoicePayeeSession();
    const body = schema.parse(await req.json().catch(() => ({})));

    const data = await getCleanerInvoiceData({
      userId: session.user.id,
      startDate: body.startDate,
      endDate: body.endDate,
      showSpentHours: body.showSpentHours,
      showHours: body.showHours,
      jobComments: body.jobComments,
      jobHourOverrides: body.jobHourOverrides,
      excludeInvoicedJobs: true,
      excludedJobIds: body.excludedJobIds,
      excludedRunIds: body.excludedRunIds,
    });

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: invoiceErrorMessage(err?.message) },
      { status: invoiceErrorStatus(err?.message) }
    );
  }
}
