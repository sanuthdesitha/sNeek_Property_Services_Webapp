import type { ServiceChecklist } from "./types";

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ChecklistPdfExtra {
  label: string;
  instructions?: string;
}

/**
 * Plain, print-friendly checklist HTML for the PDF attached to a quote — what's
 * covered, what's not, plus any extras added on the quote. Matches the plain
 * quote template aesthetic and uses the invoice (white-bg) logo.
 */
export function buildChecklistHtml(
  checklist: ServiceChecklist,
  opts: { companyName?: string; logoUrl?: string; serviceLabel?: string; extras?: ChecklistPdfExtra[] } = {}
): string {
  const companyName = opts.companyName?.trim() || "sNeek Property Services";
  const logoUrl = opts.logoUrl?.trim() || "";
  const serviceLabel = opts.serviceLabel?.trim() || checklist.jobType.replace(/_/g, " ");
  const extras = (opts.extras ?? []).filter((e) => e.label?.trim());

  const sectionsHtml = checklist.sections
    .map((section) => {
      const items = section.items.filter((i) => i.covered);
      if (items.length === 0) return "";
      const rows = items
        .map(
          (i) => `
          <li style="margin:0 0 6px 0;">
            <span style="color:#16a34a;font-weight:700;">&#10003;</span> ${esc(i.label)}
          </li>`
        )
        .join("");
      return `
        <div style="margin:0 0 14px 0;break-inside:avoid;">
          <p style="margin:0 0 6px 0;font-weight:700;font-size:14px;color:#111;">${esc(section.title)}</p>
          <ul style="list-style:none;padding:0;margin:0;font-size:13px;color:#333;">${rows}</ul>
        </div>`;
    })
    .join("");

  const notCovered = (checklist.notCovered ?? []).filter(Boolean);
  const notCoveredHtml = notCovered.length
    ? `<div style="margin-top:18px;">
        <p style="margin:0 0 6px 0;font-weight:700;font-size:14px;color:#b91c1c;">Not included</p>
        <ul style="font-size:13px;color:#555;margin:0;padding-left:18px;">
          ${notCovered.map((n) => `<li style="margin:0 0 4px 0;">${esc(n)}</li>`).join("")}
        </ul>
      </div>`
    : "";

  const extrasHtml = extras.length
    ? `<div style="margin-top:18px;padding:12px 14px;border:1px solid #e5e7eb;border-radius:8px;background:#faf9f6;">
        <p style="margin:0 0 6px 0;font-weight:700;font-size:14px;color:#111;">Added to your quote</p>
        <ul style="list-style:none;padding:0;margin:0;font-size:13px;color:#333;">
          ${extras
            .map(
              (e) => `<li style="margin:0 0 6px 0;"><span style="color:#2563eb;font-weight:700;">+</span> ${esc(e.label)}${
                e.instructions ? `<br/><span style="color:#777;font-size:12px;">${esc(e.instructions)}</span>` : ""
              }</li>`
            )
            .join("")}
        </ul>
      </div>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>${esc(companyName)} — ${esc(serviceLabel)} checklist</title></head>
  <body style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:820px;margin:0 auto;padding:32px;">
    <div style="display:flex;align-items:center;gap:12px;border-bottom:2px solid #e5e7eb;padding-bottom:14px;">
      ${logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(companyName)}" style="height:46px;object-fit:contain;background:#fff;" />` : ""}
      <div>
        <p style="margin:0;font-size:18px;font-weight:700;">${esc(companyName)}</p>
        <p style="margin:2px 0 0 0;color:#6b7280;font-size:13px;">Service checklist</p>
      </div>
    </div>

    <h1 style="font-size:20px;margin:18px 0 4px 0;">${esc(serviceLabel)}</h1>
    ${checklist.summary ? `<p style="margin:0 0 14px 0;color:#555;font-size:13px;">${esc(checklist.summary)}</p>` : ""}

    <p style="margin:8px 0;font-weight:700;font-size:15px;">What's included</p>
    ${sectionsHtml || `<p style="color:#777;font-size:13px;">Itemised on request.</p>`}

    ${extrasHtml}
    ${notCoveredHtml}

    <p style="margin-top:22px;color:#9ca3af;font-size:11px;text-align:center;">
      ${esc(companyName)} — this checklist accompanies your quote. Extras can be added or removed before booking.
    </p>
  </body>
</html>`;
}
