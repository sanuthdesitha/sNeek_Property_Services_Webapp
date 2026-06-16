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
  // Restrained luxury palette — quiet, elegant; a single thin accent.
  const ink = "#23282e";
  const muted = "#7b7468";
  const hair = "#ece7dd";
  const accent = "#b08d57"; // muted bronze
  const serif = "Georgia, 'Times New Roman', serif";
  const sans = "Arial, Helvetica, sans-serif";
  const gstAmount = Number(quote.gstAmount ?? 0);
  const shortRef = String(quote.id).slice(-6).toUpperCase();
  const serviceLabel = String(quote.serviceType ?? "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c: string) => c.toUpperCase());

  const lineRows = lineItems
    .map(
      (item: any) => `
      <tr>
        <td style="padding:11px 2px;border-bottom:1px solid ${hair};font-size:14px;color:${ink};">${escapeHtml(item.label)}</td>
        <td style="padding:11px 2px;border-bottom:1px solid ${hair};text-align:right;font-size:13px;color:${muted};">${Number(item.qty) % 1 === 0 ? Number(item.qty) : Number(item.qty).toFixed(2)}</td>
        <td style="padding:11px 2px;border-bottom:1px solid ${hair};text-align:right;font-size:13px;color:${muted};">$${Number(item.unitPrice).toFixed(2)}</td>
        <td style="padding:11px 2px;border-bottom:1px solid ${hair};text-align:right;font-size:14px;color:${ink};">$${Number(item.total).toFixed(2)}</td>
      </tr>`
    )
    .join("");

  const metaChips = meta
    ? [
        ["Bedrooms", meta.bedrooms],
        ["Bathrooms", meta.bathrooms],
        ["Floors", meta.floors],
        ["Area", meta.sqm ? `${meta.sqm} sqm` : undefined],
        ["Condition", meta.conditionScore ? `${meta.conditionScore}/5` : undefined],
        ["Carpet rooms", meta.steamCarpetRooms],
        ["Windows", meta.windowAreaSqm ? `${meta.windowAreaSqm} sqm` : undefined],
        ["Pressure wash", meta.pressureWashSqm ? `${meta.pressureWashSqm} sqm` : undefined],
      ]
        .filter(([, value]) => value !== undefined && value !== null && value !== 0 && value !== "")
        .map(
          ([label, value]) =>
            `<span style="display:inline-block;margin:0 16px 6px 0;font-size:12px;color:${muted};">${escapeHtml(label)}: <strong style="color:${ink};font-weight:600;">${escapeHtml(value)}</strong></span>`
        )
        .join("")
    : "";

  const gstSummaryHtml =
    gstAmount > 0
      ? `<tr><td style="padding:5px 0;color:${muted};font-size:13px;">GST (10%)</td><td style="padding:5px 0;text-align:right;color:${ink};font-size:13px;">$${gstAmount.toFixed(2)}</td></tr>`
      : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(companyName)} — Quotation ${escapeHtml(shortRef)}</title>
  </head>
  <body style="margin:0;padding:0;background:#ffffff;font-family:${sans};color:${ink};">
    <div style="max-width:760px;margin:0 auto;padding:44px 44px 36px 44px;">

      <!-- Header -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:middle;">
            ${
              logoUrl
                ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(companyName)}" style="height:50px;max-width:220px;object-fit:contain;background:#fff;display:block;" />`
                : `<span style="font-family:${serif};font-size:21px;color:${ink};">${escapeHtml(companyName)}</span>`
            }
          </td>
          <td style="vertical-align:middle;text-align:right;">
            <div style="font-family:${sans};font-size:10px;letter-spacing:3px;color:${accent};text-transform:uppercase;">Quotation</div>
            <div style="font-family:${serif};font-size:17px;color:${ink};margin-top:3px;">No. ${escapeHtml(shortRef)}</div>
          </td>
        </tr>
      </table>
      <div style="height:2px;width:46px;background:${accent};margin:16px 0 24px 0;"></div>

      <!-- Parties -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:top;width:55%;">
            <div style="font-size:10px;letter-spacing:2px;color:${muted};text-transform:uppercase;margin-bottom:5px;">Prepared for</div>
            <div style="font-family:${serif};font-size:19px;color:${ink};">${escapeHtml(recipient)}</div>
            <div style="margin-top:4px;font-size:13px;color:${muted};">${escapeHtml(serviceLabel)}</div>
          </td>
          <td style="vertical-align:top;text-align:right;font-size:13px;color:${muted};line-height:1.7;">
            <div>Issued ${format(new Date(quote.createdAt), "dd MMM yyyy")}</div>
            ${quote.validUntil ? `<div>Valid until ${format(new Date(quote.validUntil), "dd MMM yyyy")}</div>` : ""}
          </td>
        </tr>
      </table>

      ${
        metaChips
          ? `<div style="margin-top:22px;padding-top:16px;border-top:1px solid ${hair};">
              <div style="font-size:10px;letter-spacing:2px;color:${muted};text-transform:uppercase;margin-bottom:9px;">Service details</div>
              <div>${metaChips}</div>
            </div>`
          : ""
      }

      <!-- Items -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:26px;">
        <thead>
          <tr>
            <th style="padding:0 2px 8px 2px;border-bottom:1px solid ${ink};text-align:left;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${muted};font-weight:600;">Description</th>
            <th style="padding:0 2px 8px 2px;border-bottom:1px solid ${ink};text-align:right;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${muted};font-weight:600;">Qty</th>
            <th style="padding:0 2px 8px 2px;border-bottom:1px solid ${ink};text-align:right;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${muted};font-weight:600;">Unit</th>
            <th style="padding:0 2px 8px 2px;border-bottom:1px solid ${ink};text-align:right;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${muted};font-weight:600;">Amount</th>
          </tr>
        </thead>
        <tbody>${lineRows}</tbody>
      </table>

      <!-- Totals -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;">
        <tr><td></td><td style="width:280px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:5px 0;color:${muted};font-size:13px;">Subtotal</td><td style="padding:5px 0;text-align:right;color:${ink};font-size:13px;">$${Number(quote.subtotal).toFixed(2)}</td></tr>
            ${gstSummaryHtml}
            <tr>
              <td style="padding:12px 0 0 0;border-top:1px solid ${ink};font-family:${serif};font-size:16px;color:${ink};">Total${gstAmount > 0 ? " (inc. GST)" : ""}</td>
              <td style="padding:12px 0 0 0;border-top:1px solid ${ink};text-align:right;font-family:${serif};font-size:19px;color:${ink};">$${Number(quote.totalAmount).toFixed(2)}</td>
            </tr>
          </table>
        </td></tr>
      </table>

      ${
        cleanNotes
          ? `<div style="margin-top:26px;padding-left:14px;border-left:2px solid ${accent};">
              <div style="font-size:10px;letter-spacing:2px;color:${muted};text-transform:uppercase;margin-bottom:5px;">Notes</div>
              <div style="font-size:13px;color:${ink};line-height:1.6;">${escapeHtml(cleanNotes)}</div>
            </div>`
          : ""
      }

      <div style="margin-top:36px;padding-top:16px;border-top:1px solid ${hair};text-align:center;">
        <div style="font-family:${serif};font-size:14px;color:${ink};">${escapeHtml(companyName)}</div>
        <div style="margin-top:5px;font-size:11px;color:${muted};">Prices in AUD${gstAmount > 0 ? ", inclusive of GST" : ""}. Valid for the period shown above.</div>
      </div>

    </div>
  </body>
</html>`;
}
