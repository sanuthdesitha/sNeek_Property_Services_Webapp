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

export function buildQuoteHtml(
  quote: any,
  branding?: { companyName?: string; logoUrl?: string; companyAddress?: string }
) {
  const companyName = branding?.companyName?.trim() || "sNeek Property Services";
  const logoUrl = branding?.logoUrl?.trim() || "";
  const companyAddress = branding?.companyAddress?.trim() || "";
  const recipient = quote.client?.name ?? quote.lead?.name ?? "Client";
  const recipientAddress =
    [quote.client?.address ?? quote.lead?.address, quote.client?.suburb ?? quote.lead?.suburb]
      .filter(Boolean)
      .join(", ") || "";
  const lineItems = Array.isArray(quote.lineItems) ? quote.lineItems : [];
  const { cleanNotes } = extractMetaAndNotes(quote.notes);

  // Clean, modern palette (matches the reference layout).
  const ink = "#2b3036";
  const slate = "#3a4047"; // table header + title
  const muted = "#6b7280";
  const hair = "#e5e7eb";
  const lightBg = "#f3f4f6"; // total row tint
  const sans = "Arial, Helvetica, sans-serif";

  const gstAmount = Number(quote.gstAmount ?? 0);
  const shortRef = String(quote.quoteNumber ?? quote.id).slice(-7).padStart(7, "0").toUpperCase();
  const serviceLabel = String(quote.serviceType ?? "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c: string) => c.toUpperCase());
  const title = (serviceLabel ? `${serviceLabel} Quote` : "Quote").toUpperCase();
  const issued = format(new Date(quote.createdAt), "dd-MM-yyyy");
  const due = quote.validUntil
    ? format(new Date(quote.validUntil), "dd-MM-yyyy")
    : format(new Date(new Date(quote.createdAt).getTime() + 14 * 86400000), "dd-MM-yyyy");

  const lineRows = lineItems
    .map((item: any, i: number) => {
      const qty = Number(item.qty) % 1 === 0 ? Number(item.qty) : Number(item.qty).toFixed(2);
      const zebra = i % 2 === 1 ? "background:#fafafa;" : "";
      return `
      <tr style="${zebra}">
        <td style="padding:12px 14px;border-bottom:1px solid ${hair};text-align:center;font-size:13px;color:${ink};width:48px;">${qty}</td>
        <td style="padding:12px 14px;border-bottom:1px solid ${hair};font-size:13px;color:${ink};">${escapeHtml(item.label)}</td>
        <td style="padding:12px 14px;border-bottom:1px solid ${hair};text-align:right;font-size:13px;color:${ink};">${Number(item.unitPrice).toFixed(2)}</td>
        <td style="padding:12px 14px;border-bottom:1px solid ${hair};text-align:right;font-size:13px;color:${ink};font-weight:600;">$${Number(item.total).toFixed(2)}</td>
      </tr>`;
    })
    .join("");

  const gstSummaryHtml =
    gstAmount > 0
      ? `<tr><td style="padding:9px 14px;color:${muted};font-size:13px;">GST (10%)</td><td style="padding:9px 14px;text-align:right;color:${ink};font-size:13px;">$${gstAmount.toFixed(2)}</td></tr>`
      : "";

  const metaLabel = (label: string, value: string) =>
    `<tr>
      <td style="padding:4px 0;text-align:right;font-size:13px;font-weight:700;color:${ink};white-space:nowrap;">${escapeHtml(label)}</td>
      <td style="padding:4px 0 4px 28px;text-align:right;font-size:13px;color:${ink};white-space:nowrap;">${escapeHtml(value)}</td>
    </tr>`;

  // Logo always sits on a clean white, bordered chip — never an ugly dark box.
  const logoBox = logoUrl
    ? `<div style="display:inline-block;border:1px solid ${hair};border-radius:10px;background:#ffffff;padding:16px 22px;">
        <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(companyName)}" style="display:block;height:46px;max-width:210px;object-fit:contain;background:#ffffff;" />
      </div>`
    : `<div style="display:inline-block;border:1px solid ${hair};border-radius:10px;padding:24px 34px;color:${muted};font-size:14px;font-weight:600;background:#ffffff;">${escapeHtml(companyName)}</div>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(companyName)} — Quote ${escapeHtml(shortRef)}</title>
  </head>
  <body style="margin:0;padding:0;background:#ffffff;font-family:${sans};color:${ink};">
    <div style="max-width:820px;margin:0 auto;padding:48px 48px 40px 48px;">

      <!-- Header: company (left) + logo chip (right) -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:top;">
            <div style="font-size:21px;font-weight:700;color:${ink};">${escapeHtml(companyName)}</div>
            ${companyAddress ? `<div style="margin-top:6px;font-size:13px;line-height:1.5;color:${muted};">${escapeHtml(companyAddress).replace(/, /g, ",<br/>")}</div>` : ""}
          </td>
          <td style="vertical-align:top;text-align:right;">${logoBox}</td>
        </tr>
      </table>

      <!-- Title -->
      <div style="margin:34px 0 30px 0;text-align:center;font-size:40px;font-weight:800;letter-spacing:6px;color:${slate};line-height:1.15;">${escapeHtml(title)}</div>

      <!-- Bill to (left) + meta (right) -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:top;width:58%;">
            <div style="font-size:13px;font-weight:700;color:${ink};margin-bottom:8px;">Bill To</div>
            <div style="font-size:18px;color:${ink};">${escapeHtml(recipient)}</div>
            ${recipientAddress ? `<div style="margin-top:6px;font-size:13px;line-height:1.5;color:${muted};">${escapeHtml(recipientAddress).replace(/, /g, ",<br/>")}</div>` : ""}
          </td>
          <td style="vertical-align:top;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${metaLabel("Quote #", shortRef)}
              ${metaLabel("Quote date", issued)}
              ${metaLabel("Due date", due)}
            </table>
          </td>
        </tr>
      </table>

      <!-- Items -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:34px;">
        <thead>
          <tr style="background:${slate};">
            <th style="padding:12px 14px;text-align:center;font-size:12px;letter-spacing:.5px;text-transform:uppercase;color:#ffffff;font-weight:700;">Qty</th>
            <th style="padding:12px 14px;text-align:left;font-size:12px;letter-spacing:.5px;text-transform:uppercase;color:#ffffff;font-weight:700;">Description</th>
            <th style="padding:12px 14px;text-align:right;font-size:12px;letter-spacing:.5px;text-transform:uppercase;color:#ffffff;font-weight:700;">Unit Price</th>
            <th style="padding:12px 14px;text-align:right;font-size:12px;letter-spacing:.5px;text-transform:uppercase;color:#ffffff;font-weight:700;">Amount</th>
          </tr>
        </thead>
        <tbody>${lineRows}</tbody>
      </table>

      <!-- Totals -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
        <tr><td></td><td style="width:320px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr><td style="padding:9px 14px;color:${muted};font-size:13px;">Subtotal</td><td style="padding:9px 14px;text-align:right;color:${ink};font-size:13px;">$${Number(quote.subtotal).toFixed(2)}</td></tr>
            ${gstSummaryHtml}
            <tr style="background:${lightBg};">
              <td style="padding:13px 14px;font-size:15px;font-weight:800;color:${ink};">Total (AUD)</td>
              <td style="padding:13px 14px;text-align:right;font-size:16px;font-weight:800;color:${ink};">$${Number(quote.totalAmount).toFixed(2)}</td>
            </tr>
          </table>
        </td></tr>
      </table>

      <!-- Terms -->
      <div style="margin-top:40px;">
        <div style="font-size:14px;font-weight:700;color:${ink};margin-bottom:10px;">Terms and Conditions</div>
        ${
          cleanNotes
            ? `<div style="font-size:13px;color:${ink};line-height:1.7;white-space:pre-wrap;">${escapeHtml(cleanNotes)}</div>`
            : `<div style="font-size:13px;color:${ink};line-height:1.7;">Payment is due within 14 days of acceptance.<br/>Please make payment to ${escapeHtml(companyName)}.</div>`
        }
      </div>

      <!-- Signature -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:80px;">
        <tr><td></td><td style="width:300px;text-align:center;">
          <div style="border-top:1px solid ${ink};padding-top:8px;font-size:12px;color:${muted};">customer signature</div>
        </td></tr>
      </table>

    </div>
  </body>
</html>`;
}
