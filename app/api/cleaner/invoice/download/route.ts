import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  buildCleanerInvoiceHtml,
  getCleanerInvoiceData,
  renderCleanerInvoicePdf,
} from "@/lib/cleaner/invoice";
import {
  invoiceErrorMessage,
  invoiceErrorStatus,
  invoiceFileStem,
  requireInvoicePayeeSession,
} from "@/lib/invoicing/access";

// Payee = session.user.id, always. Never a caller-supplied id, which is what
// makes it safe for this route to serve QA inspectors as well as cleaners.

const schema = z.object({
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  showSpentHours: z.boolean().optional(),
  showHours: z.boolean().optional(),
  jobComments: z.record(z.string(), z.string()).optional(),
  jobHourOverrides: z.record(z.string(), z.number().nonnegative()).optional(),
  excludedJobIds: z.array(z.string().min(1)).max(500).optional(),
  excludedRunIds: z.array(z.string().min(1)).max(500).optional(),
  // When true the PDF is served with an inline disposition so it renders inside
  // the on-screen preview iframe instead of triggering a browser download.
  inline: z.boolean().optional(),
});

async function buildInvoicePdfResponse(
  input: {
    userId: string;
    startDate?: string;
    endDate?: string;
    showSpentHours?: boolean;
    showHours?: boolean;
    jobComments?: Record<string, string>;
    jobHourOverrides?: Record<string, number>;
    excludedJobIds?: string[];
    excludedRunIds?: string[];
  },
  opts: { inline?: boolean } = {}
) {
  const data = await getCleanerInvoiceData({ ...input, excludeInvoicedJobs: true });
  const html = buildCleanerInvoiceHtml(data);
  const pdf = await renderCleanerInvoicePdf(html);
  const fileName = `${invoiceFileStem(data.payeeRole)}-${data.start
    .toISOString()
    .slice(0, 10)}-to-${data.end.toISOString().slice(0, 10)}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${opts.inline ? "inline" : "attachment"}; filename=\"${fileName}\"`,
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireInvoicePayeeSession();
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate") ?? undefined;
    const endDate = searchParams.get("endDate") ?? undefined;
    const showSpentHours = searchParams.get("showSpentHours") === "true";
    // Hours are shown unless explicitly turned off (?showHours=false).
    const showHours = searchParams.get("showHours") !== "false";
    const inline = searchParams.get("inline") === "1" || searchParams.get("inline") === "true";

    return buildInvoicePdfResponse(
      {
        userId: session.user.id,
        startDate,
        endDate,
        showSpentHours,
        showHours,
      },
      { inline }
    );
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
    return buildInvoicePdfResponse(
      {
        userId: session.user.id,
        startDate: body.startDate,
        endDate: body.endDate,
        showSpentHours: body.showSpentHours,
        showHours: body.showHours,
        jobComments: body.jobComments,
        jobHourOverrides: body.jobHourOverrides,
        excludedJobIds: body.excludedJobIds,
        excludedRunIds: body.excludedRunIds,
      },
      { inline: body.inline }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: invoiceErrorMessage(err?.message) },
      { status: invoiceErrorStatus(err?.message) }
    );
  }
}
