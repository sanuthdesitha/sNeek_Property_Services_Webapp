import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { archiveSummaryHeader, buildInvoicePdfArchive, pdfArchiveSchema } from "@/lib/billing/client-invoice-pdf-archive";

/**
 * POST { ids } → a ZIP of the selected invoices' PDFs, streamed. The summary
 * (how many were included and every row that could not be rendered, with its
 * reason) is in the X-Archive-Summary header as URI-encoded JSON; the failures
 * are also in `_errors.txt` inside the archive. Same roles as the single PDF
 * route; the finance ops pack applies through middleware.
 */
export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = pdfArchiveSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Select invoices to download." }, { status: 400 });
    }
    const archive = await buildInvoicePdfArchive(parsed.data.ids);
    if (archive.summary.included.length === 0) {
      return NextResponse.json({ error: "None of the selected invoices could be rendered.", summary: archive.summary }, { status: 422 });
    }
    const chunks = [...archive.chunks];
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift();
        if (next) controller.enqueue(next);
        else controller.close();
      },
    });
    const day = new Date().toISOString().slice(0, 10);
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(archive.byteLength),
        "Content-Disposition": `attachment; filename="client-invoices-${day}.zip"`,
        "X-Archive-Summary": encodeURIComponent(JSON.stringify(archiveSummaryHeader(archive.summary))),
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not build the archive.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
