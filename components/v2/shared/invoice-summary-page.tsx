import { requireSession } from "@/lib/auth/session";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getPortalInvoiceSummary } from "@/lib/billing/portal-invoice-summary";

const date = (value: Date | null) => value
  ? new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", dateStyle: "medium" }).format(value)
  : "Not specified";

export async function InvoiceSummaryPage({ id, portal }: { id: string; portal: "admin" | "client" }) {
  let invoice;
  try {
    invoice = await getPortalInvoiceSummary(id, portal);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") redirect("/v2/login");
    if (error instanceof Error && error.message === "FORBIDDEN") notFound();
    throw error;
  }
  if (!invoice) notFound();
  const allowClientDownload = portal === "client" && (await requireSession()).user.role === "CLIENT" && ["APPROVED", "SENT", "PART_PAID", "PARTIALLY_PAID", "PAID"].includes(invoice.status);
  const period = invoice.periodStart || invoice.periodEnd
    ? `${date(invoice.periodStart)} - ${date(invoice.periodEnd)}`
    : "Not specified";
  const href = portal === "admin" ? "/v2/admin/finance?tab=invoices" : "/v2/client/finance";
  return <div className="space-y-6">
    <Link href={href} className="inline-flex min-h-11 items-center gap-2 rounded px-2 text-sm focus-visible:outline focus-visible:outline-2">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />Invoices
    </Link>
    <header className="border-b border-[hsl(var(--e-border))] pb-4">
      <p className="mb-2 text-xs font-medium">Invoice</p>
      <h1 className="break-words text-2xl font-semibold">{invoice.invoiceNumber}</h1>
      <p className="mt-2 text-sm">{invoice.status.replace(/_/g, " ")}</p>
    </header>
    {allowClientDownload ? <section className="space-y-2 rounded border p-4 text-sm"><a className="inline-flex min-h-11 items-center underline" href={`/api/client/invoices/${encodeURIComponent(invoice.id)}/pdf`}>Download invoice PDF</a><p>You can upload this PDF as a bill in your own Xero account and review its details there. This download does not connect to or import into your Xero account.</p><a className="inline-flex min-h-11 items-center underline" href="https://central.xero.com/s/article/Upload-bills-into-Xero" target="_blank" rel="noopener noreferrer">Xero: upload bills</a></section> : null}
    <dl className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
      <div><dt className="text-sm text-[hsl(var(--e-muted-foreground))]">Invoice total</dt><dd className="mt-1 text-xl font-semibold">{new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(invoice.totalAmount))}</dd></div>
      <div><dt className="text-sm text-[hsl(var(--e-muted-foreground))]">Service period</dt><dd className="mt-1 text-sm">{period}</dd></div>
      <div><dt className="text-sm text-[hsl(var(--e-muted-foreground))]">Created</dt><dd className="mt-1 text-sm">{date(invoice.createdAt)}</dd></div>
      <div><dt className="text-sm text-[hsl(var(--e-muted-foreground))]">Sent</dt><dd className="mt-1 text-sm">{invoice.sentAt ? date(invoice.sentAt) : "Not sent"}</dd></div>
    </dl>
  </div>;
}
