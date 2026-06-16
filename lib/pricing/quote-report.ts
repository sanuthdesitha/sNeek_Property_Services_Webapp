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
  const gstAmount = Number(quote.gstAmount ?? 0);
  const gstSummaryHtml =
    gstAmount > 0
      ? `<tr><td style="padding:6px 0;color:#5b6573;">GST (10%)</td><td style="padding:6px 0;text-align:right;color:#1f2d3d;">$${gstAmount.toFixed(2)}</td></tr>`
      : "";
  const shortRef = String(quote.id).slice(-8).toUpperCase();
  const serviceLabel = String(quote.serviceType ?? "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c: string) => c.toUpperCase());

  // ---- Luxury palette (matches the site's luxury report theme) ----
  const slate = "#1f2d3d"; // deep slate
  const gold = "#c8a24a"; // warm gold
  const ink = "#26303c";
  const muted = "#6b7280";
  const cream = "#f6f3ec";
  const hairline = "#e7e2d6";
  const serif = "Georgia, 'Times New Roman', 'Cormorant Garamond', serif";
  const sans = "'Helvetica Neue', Arial, sans-serif";

  const luxuryLineRows = lineItems
    .map(
      (item: any, i: number) => `
      <tr style="background:${i % 2 === 0 ? "#ffffff" : "#fbfaf6"};">
        <td style="padding:13px 16px;border-bottom:1px solid ${hairline};color:${ink};">${escapeHtml(item.label)}</td>
        <td style="padding:13px 16px;border-bottom:1px solid ${hairline};text-align:right;color:${muted};">${Number(item.qty).toFixed(Number.isInteger(Number(item.qty)) ? 0 : 2)}</td>
        <td style="padding:13px 16px;border-bottom:1px solid ${hairline};text-align:right;color:${muted};">$${Number(item.unitPrice).toFixed(2)}</td>
        <td style="padding:13px 16px;border-bottom:1px solid ${hairline};text-align:right;color:${ink};font-weight:600;">$${Number(item.total).toFixed(2)}</td>
      </tr>`
    )
    .join("");

  const luxuryMetaRows = meta
    ? [
        ["Bedrooms", meta.bedrooms],
        ["Bathrooms", meta.bathrooms],
        ["Floors", meta.floors],
        ["Area (sqm)", meta.sqm],
        ["Condition (1-5)", meta.conditionScore],
        ["Steam carpet rooms", meta.steamCarpetRooms],
        ["Window cleaning (sqm)", meta.windowAreaSqm],
        ["Pressure wash (sqm)", meta.pressureWashSqm],
      ]
        .filter(([, value]) => value !== undefined && value !== null && value !== 0)
        .map(
          ([label, value]) =>
            `<span style="display:inline-block;margin:0 18px 8px 0;font-size:13px;color:${muted};">${escapeHtml(label)}: <strong style="color:${ink};">${escapeHtml(value)}</strong></span>`
        )
        .join("")
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(companyName)} — Quotation ${escapeHtml(shortRef)}</title>
  </head>
  <body style="margin:0;padding:0;background:${cream};font-family:${sans};color:${ink};">
    <div style="max-width:820px;margin:0 auto;background:#ffffff;">

      <!-- Header band -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${slate};">
        <tr>
          <td style="padding:30px 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle;">
                  ${
                    logoUrl
                      ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(companyName)}" style="height:64px;max-width:240px;object-fit:contain;display:block;" />`
                      : `<span style="font-family:${serif};font-size:26px;color:#ffffff;letter-spacing:0.5px;">${escapeHtml(companyName)}</span>`
                  }
                </td>
                <td style="vertical-align:middle;text-align:right;">
                  <div style="font-family:${sans};font-size:11px;letter-spacing:4px;color:${gold};text-transform:uppercase;">Quotation</div>
                  <div style="font-family:${serif};font-size:22px;color:#ffffff;margin-top:4px;">#${escapeHtml(shortRef)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr><td style="height:3px;background:${gold};"></td></tr>
      </table>

      <!-- Meta row -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:30px 40px 8px 40px;vertical-align:top;width:55%;">
            <div style="font-size:11px;letter-spacing:2px;color:${gold};text-transform:uppercase;margin-bottom:6px;">Prepared for</div>
            <div style="font-family:${serif};font-size:22px;color:${slate};">${escapeHtml(recipient)}</div>
            <div style="margin-top:6px;font-size:14px;color:${muted};">${escapeHtml(serviceLabel)}</div>
          </td>
          <td style="padding:30px 40px 8px 40px;vertical-align:top;text-align:right;">
            <div style="font-size:13px;color:${muted};margin:2px 0;">Issued ${format(new Date(quote.createdAt), "dd MMM yyyy")}</div>
            ${
              quote.validUntil
                ? `<div style="display:inline-block;margin-top:8px;padding:6px 14px;border:1px solid ${gold};border-radius:999px;font-size:12px;color:${slate};">Valid until ${format(new Date(quote.validUntil), "dd MMM yyyy")}</div>`
                : ""
            }
          </td>
        </tr>
      </table>

      ${
        luxuryMetaRows
          ? `<div style="padding:8px 40px 0 40px;">
              <div style="border-top:1px solid ${hairline};padding-top:16px;">
                <div style="font-size:11px;letter-spacing:2px;color:${muted};text-transform:uppercase;margin-bottom:10px;">Service details</div>
                <div>${luxuryMetaRows}</div>
              </div>
            </div>`
          : ""
      }

      <!-- Line items -->
      <div style="padding:24px 40px 0 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${hairline};border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:${slate};">
              <th style="padding:12px 16px;text-align:left;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#ffffff;font-weight:600;">Description</th>
              <th style="padding:12px 16px;text-align:right;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#ffffff;font-weight:600;">Qty</th>
              <th style="padding:12px 16px;text-align:right;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#ffffff;font-weight:600;">Unit</th>
              <th style="padding:12px 16px;text-align:right;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#ffffff;font-weight:600;">Amount</th>
            </tr>
          </thead>
          <tbody>${luxuryLineRows}</tbody>
        </table>
      </div>

      <!-- Totals -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:18px 40px 0 40px;text-align:right;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table;min-width:280px;">
              <tr><td style="padding:6px 0;color:${muted};">Subtotal</td><td style="padding:6px 0;text-align:right;color:${ink};">$${Number(quote.subtotal).toFixed(2)}</td></tr>
              ${gstSummaryHtml}
              <tr><td colspan="2" style="padding:4px 0;"><div style="border-top:1px solid ${hairline};"></div></td></tr>
              <tr>
                <td style="padding:10px 0;font-family:${serif};font-size:18px;color:${slate};">Total ${gstAmount > 0 ? "(inc. GST)" : ""}</td>
                <td style="padding:10px 0;text-align:right;font-family:${serif};font-size:24px;color:${gold};font-weight:700;">$${Number(quote.totalAmount).toFixed(2)}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      ${
        cleanNotes
          ? `<div style="padding:22px 40px 0 40px;">
              <div style="background:${cream};border-left:3px solid ${gold};padding:14px 18px;border-radius:4px;">
                <div style="font-size:11px;letter-spacing:2px;color:${muted};text-transform:uppercase;margin-bottom:6px;">Notes</div>
                <div style="font-size:14px;color:${ink};line-height:1.6;">${escapeHtml(cleanNotes)}</div>
              </div>
            </div>`
          : ""
      }

      <!-- Footer -->
      <div style="padding:28px 40px 36px 40px;margin-top:24px;">
        <div style="border-top:1px solid ${hairline};padding-top:18px;text-align:center;">
          <div style="font-family:${serif};font-size:16px;color:${slate};">${escapeHtml(companyName)}</div>
          <div style="font-size:12px;color:${muted};margin-top:6px;line-height:1.6;">
            This quotation is valid for the period shown above. Prices are in AUD${gstAmount > 0 ? " and include GST" : ""}.<br/>
            We look forward to caring for your property.
          </div>
        </div>
      </div>

    </div>
  </body>
</html>`;
}
