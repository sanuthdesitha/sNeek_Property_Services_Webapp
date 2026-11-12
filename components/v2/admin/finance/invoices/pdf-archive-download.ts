/**
 * Bulk "Download PDFs": one request for a ZIP of the selected invoices
 * (POST /api/admin/invoices/pdf-archive), saved as a file, with the server's
 * summary read from the X-Archive-Summary header so every invoice that could
 * not be rendered is shown, not silently missing.
 */
import type { PdfArchiveHeaderSummary } from "@/lib/billing/client-invoice-pdf-archive";

/** Mirrors the server cap (PDF_ARCHIVE_MAX_INVOICES); the server refuses more. */
export const PDF_ARCHIVE_MAX_INVOICES = 50;

export type ArchiveOutcome =
  | { status: "done"; summary: PdfArchiveHeaderSummary }
  | { status: "failed"; message: string };

export function readArchiveSummary(header: string | null): PdfArchiveHeaderSummary | null {
  if (!header) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(header)) as PdfArchiveHeaderSummary;
    return typeof parsed.includedCount === "number" && Array.isArray(parsed.failed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function downloadPdfArchive(ids: string[]): Promise<ArchiveOutcome> {
  try {
    const response = await fetch("/api/admin/invoices/pdf-archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return { status: "failed", message: body?.error ?? "The PDFs could not be prepared." };
    }
    const summary = readArchiveSummary(response.headers.get("X-Archive-Summary"));
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `client-invoices-${new Date().toISOString().slice(0, 10)}.zip`;
    link.click();
    URL.revokeObjectURL(url);
    if (!summary) return { status: "failed", message: "The archive downloaded, but its summary could not be read. Open _errors.txt in it, if present, for invoices left out." };
    return { status: "done", summary };
  } catch {
    return { status: "failed", message: "Could not reach the server. No archive was downloaded." };
  }
}
