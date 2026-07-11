import type { EXTRAS_BY_CATEGORY } from "@/lib/pricing/extras-catalog";
import { renderBrandLogo } from "@/lib/branding/logo-html";

/**
 * "Optional add-ons you can request anytime" — a clean, print-friendly list of
 * every add-on in the catalog, grouped by category, attached to outgoing quote
 * emails so the client can see what else they can ask for. Prices are shown
 * ONLY when the quote's `showAddOnPrices` flag is on (prices change often, so
 * the default presentation is "on request").
 */

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface AddOnListHtmlOptions {
  companyName: string;
  logoUrl?: string;
  /** Show each add-on's price. When false, a subtle "on request" note stands in. */
  showPrices: boolean;
  categories: typeof EXTRAS_BY_CATEGORY;
  /** Optional public quote link printed in the footer so the reader can act. */
  publicUrl?: string;
}

export function buildAddOnListHtml(opts: AddOnListHtmlOptions): string {
  const companyName = opts.companyName?.trim() || "sNeek Property Services";
  const logoUrl = (opts.logoUrl ?? "").trim();

  const ink = "#2b3036";
  const slate = "#3a4047";
  const muted = "#6b7280";
  const hair = "#e5e7eb";
  const sans = "Arial, Helvetica, sans-serif";

  // Same premium letterhead treatment as every other client document.
  const logoBox = renderBrandLogo(logoUrl, companyName, { height: 52, align: "right", wordmarkColor: slate });

  const groupsHtml = opts.categories
    .map((group) => {
      if (!group.options.length) return "";
      const rows = group.options
        .map((option, i) => {
          const zebra = i % 2 === 1 ? "background:#fafafa;" : "";
          const priceCell = opts.showPrices
            ? `<td style="padding:9px 12px;border-bottom:1px solid ${hair};text-align:right;font-size:12.5px;color:${ink};white-space:nowrap;font-weight:600;">$${Number(option.price).toFixed(2)}</td>`
            : `<td style="padding:9px 12px;border-bottom:1px solid ${hair};text-align:right;font-size:12px;color:${muted};white-space:nowrap;">On request</td>`;
          return `
          <tr style="${zebra}">
            <td style="padding:9px 12px;border-bottom:1px solid ${hair};font-size:12.5px;color:${ink};">${esc(option.label)}</td>
            ${priceCell}
          </tr>`;
        })
        .join("");
      return `
      <div style="margin:0 0 18px 0;break-inside:avoid;">
        <div style="font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${slate};padding:0 0 6px 0;border-bottom:2px solid ${slate};margin-bottom:0;">${esc(group.label)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    })
    .join("");

  const publicUrlHtml = opts.publicUrl
    ? `<div style="margin-top:24px;text-align:center;">
        <a href="${esc(opts.publicUrl)}" style="display:inline-block;background:${slate};color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;padding:11px 26px;border-radius:6px;">View your quote online</a>
        <div style="margin-top:8px;font-size:11px;color:${muted};">${esc(opts.publicUrl)}</div>
      </div>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${esc(companyName)} — Optional add-ons</title>
  </head>
  <body style="margin:0;padding:0;background:#ffffff;font-family:${sans};color:${ink};">
    <div style="max-width:820px;margin:0 auto;padding:44px 48px 36px 48px;">

      <!-- Letterhead -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:top;">
            <div style="font-size:20px;font-weight:700;color:${ink};">${esc(companyName)}</div>
            <div style="margin-top:4px;font-size:13px;color:${muted};">Optional add-ons</div>
          </td>
          <td style="vertical-align:top;text-align:right;">${logoBox}</td>
        </tr>
      </table>

      <!-- Title -->
      <div style="margin:30px 0 8px 0;text-align:center;font-size:26px;font-weight:800;letter-spacing:3px;color:${slate};text-transform:uppercase;">Optional add-ons</div>
      <p style="margin:0 auto 28px auto;max-width:560px;text-align:center;font-size:13px;line-height:1.6;color:${muted};">
        Extras you can request anytime — before your booking or for a future visit.
        Just reply to your quote email or mention them when you confirm${opts.showPrices ? "." : ", and we'll confirm pricing with you."}
      </p>

      ${groupsHtml}

      ${publicUrlHtml}

      <p style="margin-top:26px;color:#9ca3af;font-size:11px;text-align:center;">
        ${esc(companyName)} — add-ons accompany your quote and can be added or removed before booking.
      </p>
    </div>
  </body>
</html>`;
}
