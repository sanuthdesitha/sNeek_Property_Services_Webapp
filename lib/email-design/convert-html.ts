/**
 * Converts a code-authored HTML email body (the wording layer's version-1
 * defaults, written as HTML with {{values}}) into blocks, once, so the email
 * becomes a stored, editable block design whose version 1 keeps the same
 * words. Plain module. Only the small HTML subset those defaults use is
 * understood: headings, paragraphs, bold, links, line breaks, lists, simple
 * tables and containers. Styling is dropped (the theme sets it). A
 * paragraph made of "<strong>Label:</strong> value" becomes a details row;
 * a paragraph of links becomes the button (first link) and link lines.
 * tests/lib/email-design-wording.test.ts proves every word and value of each
 * converted email survives.
 */
import type { BlockDraft } from "./catalog/build";
import type { DetailsRow, EmailValueFormat, Inline, InlineSegment } from "./types";

type Node = { kind: "text"; text: string } | { kind: "el"; tag: string; attrs: Record<string, string>; children: Node[] };

const VOID = new Set(["br", "img", "hr", "meta", "input", "col", "wbr"]);
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", minus: "−", times: "×", bull: "•", rarr: "→", larr: "←", copy: "©" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([a-zA-Z-:]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match = pattern.exec(source);
  while (match) {
    attrs[match[1].toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? "";
    match = pattern.exec(source);
  }
  return attrs;
}

/** A forgiving parser for the small HTML subset of code-written bodies. */
export function parseHtml(html: string): Node[] {
  const root: Node = { kind: "el", tag: "#root", attrs: {}, children: [] };
  const stack: Array<Extract<Node, { kind: "el" }>> = [root as Extract<Node, { kind: "el" }>];
  const pattern = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|[^<]+|</g;
  let match = pattern.exec(html);
  while (match) {
    const token = match[0];
    const top = stack[stack.length - 1];
    if (token.startsWith("<!--")) {
      // comments dropped
    } else if (match[1]) {
      const tag = match[1].toLowerCase();
      if (token.startsWith("</")) {
        const index = stack.map((item) => item.tag).lastIndexOf(tag);
        if (index > 0) stack.length = index;
      } else {
        const element: Extract<Node, { kind: "el" }> = { kind: "el", tag, attrs: parseAttrs(match[2] ?? ""), children: [] };
        top.children.push(element);
        if (!VOID.has(tag) && !token.endsWith("/>")) stack.push(element);
      }
    } else {
      top.children.push({ kind: "text", text: token });
    }
    match = pattern.exec(html);
  }
  return (root as Extract<Node, { kind: "el" }>).children;
}

const VALUE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

function textSegments(text: string, bold: boolean): InlineSegment[] {
  const out: InlineSegment[] = [];
  const decoded = decodeEntities(text).replace(/\s+/g, " ");
  let index = 0;
  const pattern = new RegExp(VALUE.source, "g");
  let match = pattern.exec(decoded);
  while (match) {
    if (match.index > index) out.push(bold ? { kind: "text", text: decoded.slice(index, match.index), bold: true } : { kind: "text", text: decoded.slice(index, match.index) });
    out.push(bold ? { kind: "value", name: match[1], bold: true } : { kind: "value", name: match[1] });
    index = match.index + match[0].length;
    match = pattern.exec(decoded);
  }
  if (index < decoded.length) out.push(bold ? { kind: "text", text: decoded.slice(index), bold: true } : { kind: "text", text: decoded.slice(index) });
  return out;
}

function merge(segments: InlineSegment[]): Inline {
  const out: Inline = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    if (segment.kind === "text" && last?.kind === "text" && Boolean(last.bold) === Boolean(segment.bold)) last.text += segment.text;
    else if (segment.kind === "text" && !segment.text) continue;
    else out.push({ ...segment });
  }
  // Trim the run's outer spaces and spaces around line breaks.
  if (out[0]?.kind === "text") out[0].text = out[0].text.replace(/^\s+/, "");
  const last = out[out.length - 1];
  if (last?.kind === "text") last.text = last.text.replace(/\s+$/, "");
  for (const segment of out) if (segment.kind === "text") segment.text = segment.text.replace(/ *\n */g, "\n");
  return out.filter((segment) => segment.kind === "value" || segment.text !== "");
}

function plainText(node: Node): string {
  return node.kind === "text" ? decodeEntities(node.text) : node.children.map(plainText).join("");
}

function hrefValue(href: string): { name: string } | { url: string } | null {
  const match = /^\s*\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}\s*$/.exec(href);
  if (match) return { name: match[1] };
  return href.trim() ? { url: href.trim() } : null;
}

/** Inline content of an element: text, bold, value chips; a link becomes "label (link)". */
function inlineOf(nodes: Node[], bold = false): InlineSegment[] {
  const out: InlineSegment[] = [];
  for (const node of nodes) {
    if (node.kind === "text") {
      out.push(...textSegments(node.text, bold));
      continue;
    }
    if (node.tag === "br") out.push({ kind: "text", text: "\n" });
    else if (node.tag === "strong" || node.tag === "b") out.push(...inlineOf(node.children, true));
    else if (node.tag === "a") {
      const label = inlineOf(node.children, bold);
      const target = hrefValue(node.attrs.href ?? "");
      const labelText = label.map((segment) => (segment.kind === "text" ? segment.text : "")).join("").trim();
      if (target && "name" in target) {
        if (labelText) out.push(...label, { kind: "text", text: " (" }, { kind: "value", name: target.name }, { kind: "text", text: ")" });
        else out.push({ kind: "value", name: target.name });
      } else if (target) {
        out.push(...label, { kind: "text", text: ` (${target.url})` });
      } else out.push(...label);
    } else if (["p", "div", "li", "tr", "h1", "h2", "h3", "h4"].includes(node.tag)) {
      out.push(...inlineOf(node.children, bold), { kind: "text", text: "\n" });
    } else if (node.tag === "td" || node.tag === "th") out.push(...inlineOf(node.children, bold), { kind: "text", text: " " });
    else if (node.tag !== "img" && node.tag !== "style") out.push(...inlineOf(node.children, bold));
  }
  return out;
}

export type ConvertResult = { blocks: BlockDraft[]; hasTitle: boolean; constants: Array<{ name: string; label: string; url: string }> };

type Context = { blocks: BlockDraft[]; formats: Record<string, EmailValueFormat | undefined>; buttonUsed: boolean; details: DetailsRow[] | null; constants: Array<{ name: string; label: string; url: string }> };

/** A link written literally in the body becomes a fixed link value, so it can be the button. */
function linkTarget(ctx: Context, href: string, label: string): string | null {
  const target = hrefValue(href);
  if (!target) return null;
  if ("name" in target) return ctx.formats[target.name] === "url" ? target.name : null;
  const existing = ctx.constants.find((item) => item.url === target.url);
  if (existing) return existing.name;
  const name = `fixedLink${ctx.constants.length + 1}`;
  ctx.constants.push({ name, label: `Link: ${label || target.url}`.slice(0, 60), url: target.url });
  ctx.formats[name] = "url";
  return name;
}

function flushDetails(ctx: Context): void {
  if (ctx.details?.length) ctx.blocks.push({ type: "details", rows: ctx.details });
  ctx.details = null;
}

function pushParagraph(ctx: Context, segments: InlineSegment[], type: "paragraph" | "note" = "paragraph"): void {
  const text = merge(segments);
  if (!text.length) return;
  // A paragraph that is only one built fragment is shown as built content.
  if (text.length === 1 && text[0].kind === "value" && ctx.formats[text[0].name] === "built") {
    flushDetails(ctx);
    ctx.blocks.push({ type: "lineItems", source: text[0].name });
    return;
  }
  flushDetails(ctx);
  ctx.blocks.push({ type, text });
}

/** "<strong>Label:</strong> value" → a details row. */
function detailsRow(node: Extract<Node, { kind: "el" }>, index: number): DetailsRow | null {
  const children = node.children.filter((child) => !(child.kind === "text" && !child.text.trim()));
  const first = children[0];
  if (!first || first.kind !== "el" || (first.tag !== "strong" && first.tag !== "b")) return null;
  const labelRaw = plainText(first).trim();
  const restNodes = children.slice(1);
  const restText = restNodes.map(plainText).join("");
  const labelHasColon = labelRaw.endsWith(":");
  if (!labelHasColon && !/^\s*:/.test(restText)) return null;
  if (/\{\{/.test(labelRaw) || labelRaw.length > 40 || !restNodes.length) return null;
  const value = merge(inlineOf(restNodes)).map((segment, position) => (position === 0 && segment.kind === "text" ? { ...segment, text: segment.text.replace(/^\s*:\s*/, "") } : segment)).filter((segment) => segment.kind === "value" || segment.text !== "");
  if (!value.length) return null;
  return { id: `r${index + 1}`, label: labelRaw.replace(/:$/, "").trim(), value };
}

function onlyLinks(node: Extract<Node, { kind: "el" }>): Array<Extract<Node, { kind: "el" }>> | null {
  const links: Array<Extract<Node, { kind: "el" }>> = [];
  for (const child of node.children) {
    if (child.kind === "text") {
      if (decodeEntities(child.text).replace(/[\s\-–—·|]/g, "") !== "") return null;
    } else if (child.tag === "a") links.push(child);
    else return null;
  }
  return links.length ? links : null;
}

/** Values written directly inside a list or table (not inside an item or cell): built rows or items. */
function strayValues(node: Extract<Node, { kind: "el" }>): string[] {
  const names: string[] = [];
  const visit = (list: Node[]) => {
    for (const child of list) {
      if (child.kind === "text") {
        const pattern = new RegExp(VALUE.source, "g");
        let match = pattern.exec(child.text);
        while (match) {
          names.push(match[1]);
          match = pattern.exec(child.text);
        }
      } else if (child.tag === "tbody" || child.tag === "thead") visit(child.children);
    }
  };
  visit(node.children);
  return names;
}

function convertNodes(nodes: Node[], ctx: Context): void {
  let loose: Node[] = [];
  const flushLoose = () => {
    if (loose.length) pushParagraph(ctx, inlineOf(loose));
    loose = [];
  };
  for (const node of nodes) {
    if (node.kind === "text" || ["strong", "b", "a", "span", "em", "i", "small", "br", "code"].includes(node.tag)) {
      loose.push(node);
      continue;
    }
    flushLoose();
    const tag = node.tag;
    if (/^h[1-6]$/.test(tag)) {
      flushDetails(ctx);
      const text = merge(inlineOf(node.children));
      if (text.length) ctx.blocks.push({ type: "heading", text });
    } else if (tag === "p" || tag === "blockquote" || tag === "pre") {
      const row = detailsRow(node, ctx.details?.length ?? 0);
      if (row) {
        ctx.details = [...(ctx.details ?? []), row];
        continue;
      }
      const links = onlyLinks(node);
      if (links) {
        for (const link of links) {
          const label = plainText(link).replace(/\s+/g, " ").trim();
          const target = label ? linkTarget(ctx, link.attrs.href ?? "", label) : null;
          if (!ctx.buttonUsed && target) {
            flushDetails(ctx);
            ctx.blocks.push({ type: "button", label, link: target });
            ctx.buttonUsed = true;
          } else pushParagraph(ctx, inlineOf([link]));
        }
        continue;
      }
      pushParagraph(ctx, inlineOf(node.children));
    } else if (tag === "ul" || tag === "ol") {
      const items = node.children.filter((child): child is Extract<Node, { kind: "el" }> => child.kind === "el" && child.tag === "li");
      const segments: InlineSegment[] = [];
      items.forEach((item, position) => segments.push({ kind: "text", text: `${position ? "\n" : ""}• ` }, ...merge(inlineOf(item.children))));
      pushParagraph(ctx, segments);
      // Items added by a built fragment ({{notesItem}} inside the list).
      for (const name of strayValues(node)) {
        flushDetails(ctx);
        ctx.blocks.push({ type: "lineItems", source: name });
      }
    } else if (tag === "table") {
      const rows: Array<Extract<Node, { kind: "el" }>> = [];
      const collect = (list: Node[]) => list.forEach((child) => { if (child.kind === "el") { if (child.tag === "tr") rows.push(child); else collect(child.children); } });
      collect(node.children);
      const detail: DetailsRow[] = [];
      for (const row of rows) {
        const cells = row.children.filter((child): child is Extract<Node, { kind: "el" }> => child.kind === "el" && (child.tag === "td" || child.tag === "th"));
        if (!cells.length) continue;
        if (cells.every((cell) => cell.tag === "th")) {
          pushParagraph(ctx, [{ kind: "text", text: cells.map((cell) => plainText(cell).trim()).join(" · "), bold: true }]);
          continue;
        }
        const label = plainText(cells[0]).replace(/\s+/g, " ").trim();
        const value = merge(cells.slice(1).flatMap((cell, position) => [...(position ? [{ kind: "text" as const, text: " · " }] : []), ...inlineOf(cell.children)]));
        if (cells.length >= 2 && label && !/\{\{/.test(label) && value.length) detail.push({ id: `r${detail.length + 1}`, label: label.slice(0, 60), value });
        else pushParagraph(ctx, inlineOf(row.children));
      }
      if (detail.length) {
        flushDetails(ctx);
        ctx.blocks.push({ type: "details", rows: detail });
      }
      // Rows added by a built fragment ({{timingRow}} inside the table).
      for (const name of strayValues(node)) ctx.blocks.push({ type: "lineItems", source: name });
    } else if (tag === "hr") {
      flushDetails(ctx);
      ctx.blocks.push({ type: "divider" });
    } else if (tag === "style" || tag === "img" || tag === "script") {
      // dropped: styling comes from the theme; images in these bodies are not used
    } else {
      // div, section, tbody… : a container.
      convertNodes(node.children, ctx);
    }
  }
  flushLoose();
}

export function convertHtmlBody(html: string, formats: Record<string, EmailValueFormat | undefined>): ConvertResult {
  const ctx: Context = { blocks: [], formats: { ...formats }, buttonUsed: false, details: null, constants: [] };
  convertNodes(parseHtml(html), ctx);
  flushDetails(ctx);
  return { blocks: ctx.blocks, hasTitle: ctx.blocks[0]?.type === "heading", constants: ctx.constants };
}

/** Visible words of an HTML fragment (for parity checks). */
export function htmlWords(html: string): string[] {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).split(/[\s()·:,.!?\-–—•"'“”‘’]+/).filter((word) => word.length > 0 && !/^(https?|\/\/.*)$/i.test(word));
}
