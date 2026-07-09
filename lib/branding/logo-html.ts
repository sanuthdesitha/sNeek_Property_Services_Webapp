/**
 * One premium logo treatment for every server-rendered document (quote, invoice,
 * checklist, QA/client report, email). Clean and box-free: no bordered chip, no
 * padded white backdrop — just the mark, tastefully sized, so a dark or a
 * transparent logo both read like a letterhead rather than a thumbnail. When no
 * logo is set, a spaced uppercase wordmark stands in.
 */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface BrandLogoOptions {
  /** Rendered logo height in px (width scales, capped by maxWidth). Default 54. */
  height?: number;
  /** Max logo width in px. Default 220. */
  maxWidth?: number;
  /** Horizontal alignment of the block. Default "right". */
  align?: "left" | "center" | "right";
  /** Wordmark colour when there is no logo image. Default a slate ink. */
  wordmarkColor?: string;
}

/**
 * Returns premium logo HTML — a clean `<img>` (contain-fit, no box) or a spaced
 * wordmark fallback. Safe for both PDF (Chromium) and email clients.
 */
export function renderBrandLogo(
  logoUrl: string | null | undefined,
  companyName: string,
  opts: BrandLogoOptions = {}
): string {
  const url = (logoUrl ?? "").trim();
  const height = opts.height ?? 54;
  const maxWidth = opts.maxWidth ?? 220;
  const align = opts.align ?? "right";
  const wordmarkColor = opts.wordmarkColor ?? "#2b2f36";
  const blockAlign =
    align === "center" ? "margin:0 auto;" : align === "left" ? "margin:0;" : "margin-left:auto;";

  if (url) {
    return `<img src="${esc(url)}" alt="${esc(companyName)}" style="display:block;${blockAlign}height:${height}px;width:auto;max-width:${maxWidth}px;object-fit:contain;border:0;outline:none;" />`;
  }

  return `<div style="display:inline-block;font-size:15px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${wordmarkColor};">${esc(
    companyName
  )}</div>`;
}
