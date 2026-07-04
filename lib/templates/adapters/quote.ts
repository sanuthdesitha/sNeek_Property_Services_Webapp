/**
 * Adapter: Quote (with client/lead) → the `doc.quote` data contract
 * (rebrand doc 03 §1.5, §4.2). Mirrors what lib/pricing/quote-report.ts reads.
 * Money passes as RAW NUMBERS; the template formats via {{ | money}}. Never
 * recompute totals here — the pricing calculator owns them.
 */

const NOTES_META_MARKER = /\[\[META:[\s\S]+?\]\]/;

export interface QuoteContractData {
  quote: {
    number: string;
    serviceType: string;
    issuedAt: Date;
    validUntil: Date;
    subtotal: number;
    gstAmount: number;
    totalAmount: number;
    gstEnabled: boolean;
    notes: string;
    lines: Array<{ label: string; quantity: number; unitAmount: number; lineTotal: number }>;
  };
  client: { name: string; address: string };
  actionUrl: string;
}

interface QuoteLike {
  id?: string | null;
  quoteNumber?: string | null;
  serviceType?: string | null;
  createdAt?: Date | string | null;
  validUntil?: Date | string | null;
  subtotal?: number | null;
  gstAmount?: number | null;
  totalAmount?: number | null;
  notes?: string | null;
  lineItems?: unknown;
  client?: { name?: string | null; address?: string | null; suburb?: string | null } | null;
  lead?: { name?: string | null; address?: string | null; suburb?: string | null } | null;
}

function humanServiceType(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function cleanNotes(notes: string | null | undefined): string {
  if (!notes) return "";
  return notes.replace(NOTES_META_MARKER, "").trim();
}

export function toQuoteContractData(quote: QuoteLike, actionUrl?: string | null): QuoteContractData {
  const issuedAt = quote.createdAt ? new Date(quote.createdAt) : new Date();
  const validUntil = quote.validUntil
    ? new Date(quote.validUntil)
    : new Date(issuedAt.getTime() + 14 * 86_400_000);
  const gstAmount = Number(quote.gstAmount ?? 0);
  const rawLines = Array.isArray(quote.lineItems) ? quote.lineItems : [];

  const recipient = quote.client ?? quote.lead ?? null;
  const address = [recipient?.address, recipient?.suburb].filter(Boolean).join(", ");

  return {
    quote: {
      number: quote.quoteNumber ?? quote.id ?? "",
      serviceType: humanServiceType(quote.serviceType),
      issuedAt,
      validUntil,
      subtotal: Number(quote.subtotal ?? 0),
      gstAmount,
      totalAmount: Number(quote.totalAmount ?? 0),
      gstEnabled: gstAmount > 0,
      notes: cleanNotes(quote.notes),
      lines: rawLines.map((raw) => {
        const item = (raw ?? {}) as Record<string, unknown>;
        return {
          label: String(item.label ?? ""),
          quantity: Number(item.qty ?? item.quantity ?? 0),
          unitAmount: Number(item.unitPrice ?? item.unitAmount ?? 0),
          lineTotal: Number(item.total ?? item.lineTotal ?? 0),
        };
      }),
    },
    client: {
      name: recipient?.name ?? "Client",
      address: address ?? "",
    },
    actionUrl: actionUrl ?? "",
  };
}
