import { format } from "date-fns";

type QuoteMeta = {
  bedrooms?: number;
  bathrooms?: number;
  floors?: number;
  sqm?: number;
  conditionScore?: number;
  steamCarpetRooms?: number;
  windowAreaSqm?: number;
  pressureWashSqm?: number;
};

function extractMetaAndNotes(notes: string | null | undefined): { meta: QuoteMeta | null; cleanNotes: string | null } {
  if (!notes) return { meta: null, cleanNotes: null };
  const markerRegex = /\[\[META:([\s\S]+?)\]\]/;
  const match = notes.match(markerRegex);
  if (!match) {
    return { meta: null, cleanNotes: notes };
  }

  let meta: QuoteMeta | null = null;
  try {
    meta = JSON.parse(match[1]);
  } catch {
    meta = null;
  }

  const cleanNotes = notes.replace(markerRegex, "").trim() || null;
  return { meta, cleanNotes };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildQuoteHtml(quote: any, branding?: { companyName?: string; logoUrl?: string }) {
  const companyName = branding?.companyName?.trim() || "sNeek Property Services";
  const logoUrl = branding?.logoUrl?.trim() || "";
  const recipient = quote.client?.name ?? quote.lead?.name ?? "Client";
  const lineItems = Array.isArray(quote.lineItems) ? quote.lineItems : [];
  const { meta, cleanNotes } = extractMetaAndNotes(quote.notes);
  const lineRows = lineItems
    .map(
      (item: any) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.label)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${Number(item.qty).toFixed(2)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">$${Number(item.unitPrice).toFixed(2)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">$${Number(item.total).toFixed(2)}</td>
      </tr>
    `
    )
    .join("");

  const metaRows = meta
    ? [
        ["Bedrooms", meta.bedrooms],
        ["Bathrooms", meta.bathrooms],
        ["Floors", meta.floors],
        ["Area (sqm)", meta.sqm],
        ["Condition (1-5)", meta.conditionScore],
        ["Steam Carpet Rooms", meta.steamCarpetRooms],
        ["Window Cleaning (sqm)", meta.windowAreaSqm],
        ["Pressure Wash (sqm)", meta.pressureWashSqm],
      ]
        .filter(([, value]) => value !== undefined && value !== null && value !== 0)
        .map(
          ([label, value]) => `
          <tr>
            <td style="padding:6px;border-bottom:1px solid #e5e7eb;">${escapeHtml(label)}</td>
            <td style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right;">${value}</td>
          </tr>
        `
        )
        .join("")
    : "";
  const gstSummaryHtml =
    Number(quote.gstAmount ?? 0) > 0
      ? `<p style="margin:2px 0;text-align:right;"><strong>GST:</strong> $${Number(quote.gstAmount).toFixed(2)}</p>`
      : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(companyName)} Quote ${escapeHtml(quote.id)}</title>
  </head>
  <body style="font-family:Arial,sans-serif;color:#111;max-width:900px;margin:0 auto;padding:32px;">
    <div style="display:flex;align-items:center;gap:12px;">
      ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(companyName)} logo" style="width:48px;height:48px;object-fit:contain;border-radius:10px;border:1px solid #e5e7eb;padding:4px;background:#fff;" />` : ""}
      <h1 style="margin-bottom:4px;">${escapeHtml(companyName)} Quote</h1>
    </div>
    <p style="margin:0 0 18px 0;color:#4b5563;">Quote ID: ${escapeHtml(quote.id)}</p>
    <p><strong>To:</strong> ${escapeHtml(recipient)}</p>
    <p><strong>Service:</strong> ${escapeHtml(String(quote.serviceType).replace(/_/g, " "))}</p>
    <p><strong>Issued:</strong> ${format(new Date(quote.createdAt), "dd MMM yyyy")}</p>
    <p><strong>Status:</strong> ${escapeHtml(quote.status)}</p>
    ${
      quote.validUntil
        ? `<p><strong>Valid Until:</strong> ${format(new Date(quote.validUntil), "dd MMM yyyy")}</p>`
        : ""
    }

    ${
      metaRows
        ? `<div style="margin-top:16px;">
            <p style="margin:0 0 6px 0;font-weight:700;">Service Parameters</p>
            <table style="width:100%;border-collapse:collapse;">
              <tbody>${metaRows}</tbody>
            </table>
          </div>`
        : ""
    }

    <table style="width:100%;border-collapse:collapse;margin-top:16px;">
      <thead>
        <tr>
          <th style="padding:8px;border-bottom:2px solid #d1d5db;text-align:left;">Item</th>
          <th style="padding:8px;border-bottom:2px solid #d1d5db;text-align:right;">Qty</th>
          <th style="padding:8px;border-bottom:2px solid #d1d5db;text-align:right;">Unit</th>
          <th style="padding:8px;border-bottom:2px solid #d1d5db;text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>${lineRows}</tbody>
    </table>

    <div style="margin-top:18px;">
      <p style="margin:2px 0;text-align:right;"><strong>Subtotal:</strong> $${Number(quote.subtotal).toFixed(2)}</p>
      ${gstSummaryHtml}
      <p style="margin:6px 0;text-align:right;font-size:18px;"><strong>Total: $${Number(quote.totalAmount).toFixed(2)}</strong></p>
    </div>

    ${cleanNotes ? `<p style="margin-top:18px;"><strong>Notes:</strong> ${escapeHtml(cleanNotes)}</p>` : ""}
  </body>
</html>`;
}
