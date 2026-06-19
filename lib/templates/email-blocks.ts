/**
 * Block-based email designer model + renderer.
 *
 * Emails can't use absolute positioning reliably, so the "builder" is a vertical
 * stack of blocks (the WIX-style free canvas doesn't survive Gmail/Outlook). We
 * render to table-based, inline-styled, email-safe HTML — and embed the block
 * document as an HTML comment so the designer can round-trip the same HTML
 * without needing a new database column.
 */

export type EmailBlockAlign = "left" | "center" | "right";

export type EmailBlock =
  | { id: string; type: "heading"; text: string; align: EmailBlockAlign; color: string; fontSize: number }
  | { id: string; type: "text"; text: string; align: EmailBlockAlign; color: string; fontSize: number }
  | { id: string; type: "button"; text: string; href: string; align: EmailBlockAlign; bg: string; color: string; radius: number }
  | { id: string; type: "image"; src: string; alt: string; width: number; align: EmailBlockAlign; href?: string }
  | { id: string; type: "divider"; color: string }
  | { id: string; type: "spacer"; height: number };

export type EmailDesign = {
  blocks: EmailBlock[];
  pageBackground: string;
  cardBackground: string;
};

export const EMAIL_BLOCK_TYPES: Array<{ type: EmailBlock["type"]; label: string }> = [
  { type: "heading", label: "Heading" },
  { type: "text", label: "Text" },
  { type: "button", label: "Button" },
  { type: "image", label: "Image" },
  { type: "divider", label: "Divider" },
  { type: "spacer", label: "Spacer" },
];

const DESIGN_MARKER = "SNEEK_EMAIL_DESIGN:";

let idCounter = 0;
/** Stable-ish id generator (Math.random is fine in app runtime; not in workflows). */
export function newBlockId(): string {
  idCounter += 1;
  return `b${Date.now().toString(36)}_${idCounter}`;
}

export function defaultDesign(): EmailDesign {
  return {
    pageBackground: "#f4f5f7",
    cardBackground: "#ffffff",
    blocks: [
      { id: newBlockId(), type: "heading", text: "Hi {{recipientName}},", align: "left", color: "#10322a", fontSize: 22 },
      { id: newBlockId(), type: "text", text: "Your message goes here. Use the variable chips to insert live values.", align: "left", color: "#33433d", fontSize: 15 },
    ],
  };
}

export function makeBlock(type: EmailBlock["type"]): EmailBlock {
  const id = newBlockId();
  switch (type) {
    case "heading":
      return { id, type, text: "New heading", align: "left", color: "#10322a", fontSize: 22 };
    case "text":
      return { id, type, text: "New paragraph of text.", align: "left", color: "#33433d", fontSize: 15 };
    case "button":
      return { id, type, text: "View details", href: "{{actionUrl}}", align: "left", bg: "#0f5a44", color: "#ffffff", radius: 8 };
    case "image":
      return { id, type, src: "", alt: "", width: 240, align: "center" };
    case "divider":
      return { id, type, color: "#e2e8e4" };
    case "spacer":
      return { id, type, height: 24 };
  }
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render a single block to an email-safe table row. Text is escaped but {{vars}} pass through. */
function renderBlock(block: EmailBlock): string {
  const pad = "padding:6px 0;";
  switch (block.type) {
    case "heading":
      return `<tr><td style="${pad}text-align:${block.align};color:${block.color};font-size:${block.fontSize}px;font-weight:700;line-height:1.3;font-family:Helvetica,Arial,sans-serif">${esc(block.text)}</td></tr>`;
    case "text":
      return `<tr><td style="${pad}text-align:${block.align};color:${block.color};font-size:${block.fontSize}px;line-height:1.55;font-family:Helvetica,Arial,sans-serif">${esc(block.text).replace(/\n/g, "<br/>")}</td></tr>`;
    case "button":
      return `<tr><td style="${pad}text-align:${block.align}"><a href="${esc(block.href)}" style="display:inline-block;background:${block.bg};color:${block.color};text-decoration:none;padding:12px 22px;border-radius:${block.radius}px;font-weight:700;font-size:15px;font-family:Helvetica,Arial,sans-serif">${esc(block.text)}</a></td></tr>`;
    case "image": {
      if (!block.src) return `<tr><td style="${pad}text-align:${block.align};color:#9aa6a1;font-size:13px;font-family:Helvetica,Arial,sans-serif">[image]</td></tr>`;
      const img = `<img src="${esc(block.src)}" alt="${esc(block.alt)}" width="${block.width}" style="max-width:100%;height:auto;border:0;display:inline-block" />`;
      return `<tr><td style="${pad}text-align:${block.align}">${block.href ? `<a href="${esc(block.href)}">${img}</a>` : img}</td></tr>`;
    }
    case "divider":
      return `<tr><td style="padding:10px 0"><div style="border-top:1px solid ${block.color};font-size:0;line-height:0">&nbsp;</div></td></tr>`;
    case "spacer":
      return `<tr><td style="font-size:0;line-height:0;height:${block.height}px">&nbsp;</td></tr>`;
  }
}

/** Render the full email HTML, with the design JSON embedded for round-tripping. */
export function renderEmailHtml(design: EmailDesign): string {
  const rows = design.blocks.map(renderBlock).join("");
  const json = JSON.stringify(design);
  return `<!--${DESIGN_MARKER}${json}-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${design.pageBackground};margin:0;padding:24px 0">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:${design.cardBackground};border-radius:14px;padding:28px">
      ${rows}
    </table>
  </td></tr>
</table>`;
}

/** Recover the design from previously-rendered HTML (or wrap legacy HTML). */
export function parseEmailHtml(html: string | null | undefined): EmailDesign {
  if (!html) return defaultDesign();
  const marker = html.indexOf(`<!--${DESIGN_MARKER}`);
  if (marker !== -1) {
    const start = marker + DESIGN_MARKER.length + 4;
    const end = html.indexOf("-->", start);
    if (end !== -1) {
      try {
        const parsed = JSON.parse(html.slice(start, end)) as EmailDesign;
        if (parsed && Array.isArray(parsed.blocks)) return parsed;
      } catch {
        /* fall through */
      }
    }
  }
  // Legacy raw HTML with no embedded design → keep it as a single text block so
  // nothing is lost; the user can rebuild visually from there.
  return {
    pageBackground: "#f4f5f7",
    cardBackground: "#ffffff",
    blocks: [{ id: newBlockId(), type: "text", text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000), align: "left", color: "#33433d", fontSize: 15 }],
  };
}
