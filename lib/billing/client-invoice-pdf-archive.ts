/**
 * Bulk "Download PDFs" (Wave D): one ZIP of the selected invoices' PDFs, each
 * rendered on the server by the existing renderer (the admin preview's rule:
 * an unsent invoice's due day is labelled provisional), named by its number
 * ("INV-0421.pdf"). A row that cannot be rendered is never silently missing:
 * it is listed in `_errors.txt` inside the archive and in the summary.
 *
 * Bounded: at most PDF_ARCHIVE_MAX_INVOICES per request and
 * PDF_ARCHIVE_MAX_BYTES of PDF data; past the byte cap the remaining rows are
 * listed as not included (too large), not dropped.
 */
import { z } from "zod";
import { getClientInvoice, renderClientInvoicePdf } from "./client-invoices";
import { getAppSettings } from "@/lib/settings";
import { isProvisionalDueStatus } from "./client-invoice-pdf-parts";
import { zipChunks, type ZipEntry } from "./zip-store";

export const PDF_ARCHIVE_MAX_INVOICES = 50;
export const PDF_ARCHIVE_MAX_BYTES = 60 * 1024 * 1024;

export const pdfArchiveSchema = z.object({
  ids: z
    .array(z.string().min(1).max(64))
    .min(1, "Select at least one invoice.")
    .max(PDF_ARCHIVE_MAX_INVOICES, `Select at most ${PDF_ARCHIVE_MAX_INVOICES} invoices for one download.`),
});

export type PdfArchiveFailure = { id: string; invoiceNumber: string | null; reason: string };

export type PdfArchiveSummary = {
  included: Array<{ id: string; invoiceNumber: string; fileName: string }>;
  failed: PdfArchiveFailure[];
};

export type PdfArchive = { chunks: Uint8Array[]; byteLength: number; summary: PdfArchiveSummary };

/** "INV-0421" → "INV-0421.pdf"; anything unsafe for a file name becomes "_". Duplicates get a suffix. */
export function archiveFileName(invoiceNumber: string, taken: Set<string>): string {
  const base = invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "invoice";
  let name = `${base}.pdf`;
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${base}-${n}.pdf`;
  taken.add(name.toLowerCase());
  return name;
}

export function errorsText(failed: readonly PdfArchiveFailure[]): string {
  const lines = failed.map((row) => `${row.invoiceNumber ?? row.id}: ${row.reason.replace(/\s+/g, " ")}`);
  return [`${failed.length} invoice${failed.length === 1 ? "" : "s"} could not be included in this archive:`, "", ...lines, ""].join("\r\n");
}

type Renderer = {
  load: typeof getClientInvoice;
  render: typeof renderClientInvoicePdf;
  settings: typeof getAppSettings;
};

const defaultRenderer: Renderer = { load: getClientInvoice, render: renderClientInvoicePdf, settings: getAppSettings };

export async function buildInvoicePdfArchive(ids: readonly string[], renderer: Renderer = defaultRenderer): Promise<PdfArchive> {
  const settings = await renderer.settings();
  const companyName = settings.companyName || "sNeek Property Services";
  const logo = settings.logoUrl || settings.reportLogoUrl;
  const entries: ZipEntry[] = [];
  const summary: PdfArchiveSummary = { included: [], failed: [] };
  const taken = new Set<string>(["_errors.txt"]);
  let bytes = 0;
  for (const id of Array.from(new Set(ids))) {
    let invoiceNumber: string | null = null;
    try {
      const invoice = await renderer.load(id);
      if (!invoice) {
        summary.failed.push({ id, invoiceNumber: null, reason: "Invoice not found." });
        continue;
      }
      invoiceNumber = invoice.invoiceNumber;
      if (bytes >= PDF_ARCHIVE_MAX_BYTES) {
        summary.failed.push({ id, invoiceNumber, reason: "Not included: the archive reached its size limit. Download it separately." });
        continue;
      }
      const pdf = await renderer.render(invoice, companyName, logo, settings.invoicing, { provisionalDue: isProvisionalDueStatus(invoice.status) });
      const data = new Uint8Array(pdf);
      if (data.length === 0) throw new Error("The renderer returned an empty file.");
      const fileName = archiveFileName(invoice.invoiceNumber, taken);
      entries.push({ name: fileName, data });
      bytes += data.length;
      summary.included.push({ id, invoiceNumber: invoice.invoiceNumber, fileName });
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : "The PDF could not be rendered.";
      summary.failed.push({ id, invoiceNumber, reason });
    }
  }
  if (summary.failed.length) entries.push({ name: "_errors.txt", data: new TextEncoder().encode(errorsText(summary.failed)) });
  const chunks = zipChunks(entries);
  return { chunks, byteLength: chunks.reduce((sum, chunk) => sum + chunk.length, 0), summary };
}

/** The response header's summary: the included count and every failure (reasons kept short). */
export type PdfArchiveHeaderSummary = { includedCount: number; failed: PdfArchiveFailure[] };

export function archiveSummaryHeader(summary: PdfArchiveSummary): PdfArchiveHeaderSummary {
  return {
    includedCount: summary.included.length,
    failed: summary.failed.map((row) => ({ ...row, reason: row.reason.length > 160 ? `${row.reason.slice(0, 159)}…` : row.reason })),
  };
}
