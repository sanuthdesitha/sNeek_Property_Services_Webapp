/**
 * Pure editing operations for the email editor. Plain module.
 */
import { BLOCK_LABEL, type EmailBlock, type EmailBlockType, type EmailDesignDefinition, type EmailDocument, type Inline } from "@/lib/email-design/types";

export type AddableBlock = { type: EmailBlockType; label: string; available: boolean; reason: string | null };

function nextId(doc: EmailDocument): string {
  let index = doc.blocks.length + 1;
  const ids = new Set(doc.blocks.map((block) => block.id));
  while (ids.has(`n${index}`)) index += 1;
  return `n${index}`;
}

const EMPTY: Inline = [];

/** What "Add block" offers for this type, with the reason a block is not available. */
export function addableBlocks(definition: EmailDesignDefinition, doc: EmailDocument): AddableBlock[] {
  const allowed = new Set(definition.allowedBlocks);
  const urls = definition.variables.filter((variable) => variable.format === "url");
  const rows = definition.variables.filter((variable) => variable.format === "rows" || variable.format === "built");
  const photos = definition.variables.filter((variable) => variable.format === "photos");
  const order: EmailBlockType[] = ["paragraph", "details", "callout", "divider", "signature", "note", "heading", "button", "photos", "lineItems", "code"];
  return order.map((type): AddableBlock => {
    const label = BLOCK_LABEL[type];
    if (definition.security) return { type, label, available: false, reason: "Security email: words fixed" };
    if (type === "code") return { type, label, available: false, reason: "Security emails only" };
    if (!allowed.has(type)) {
      const reason = type === "photos" ? "Not available for this email" : type === "lineItems" ? "Only for invoices, quotes and lists" : "Not used by this email type";
      return { type, label, available: false, reason };
    }
    if (type === "button" && doc.blocks.some((block) => block.type === "button")) return { type, label, available: false, reason: "One per email, already used" };
    if (type === "button" && urls.length === 0) return { type, label, available: false, reason: "This email has no link to point to" };
    if (type === "lineItems" && rows.length === 0) return { type, label, available: false, reason: "No line items for this email" };
    if (type === "photos" && photos.length === 0) return { type, label, available: false, reason: "No photos for this email" };
    const used = doc.blocks.filter((block) => block.type === type).length;
    return { type, label, available: true, reason: used ? `${used} in use` : null };
  });
}

export function newBlock(type: EmailBlockType, definition: EmailDesignDefinition, doc: EmailDocument): EmailBlock {
  const id = nextId(doc);
  const firstUrl = definition.variables.find((variable) => variable.format === "url")?.name ?? "actionUrl";
  const firstRows = definition.variables.find((variable) => variable.format === "rows" || variable.format === "built")?.name ?? "";
  const firstPhotos = definition.variables.find((variable) => variable.format === "photos")?.name ?? "";
  switch (type) {
    case "heading":
    case "paragraph":
    case "note":
      return { id, type, text: EMPTY };
    case "callout":
      return { id, type, tone: "note", text: EMPTY };
    case "details":
      return { id, type, rows: [{ id: "r1", label: "", value: EMPTY }] };
    case "button":
      return { id, type, label: "Open", link: firstUrl };
    case "lineItems":
      return { id, type, source: firstRows };
    case "photos":
      return { id, type, source: firstPhotos, caption: EMPTY };
    case "code":
      return { id, type, source: "code" };
    case "signature":
      return { id, type, name: EMPTY, role: EMPTY };
    case "divider":
      return { id, type };
  }
}

export function insertBlock(doc: EmailDocument, block: EmailBlock, afterId: string | null): EmailDocument {
  const index = afterId ? doc.blocks.findIndex((item) => item.id === afterId) : -1;
  const at = index === -1 ? doc.blocks.length : index + 1;
  return { ...doc, blocks: [...doc.blocks.slice(0, at), block, ...doc.blocks.slice(at)] };
}

export function moveBlock(doc: EmailDocument, id: string, direction: -1 | 1): EmailDocument {
  const index = doc.blocks.findIndex((block) => block.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= doc.blocks.length) return doc;
  const blocks = [...doc.blocks];
  [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
  return { ...doc, blocks };
}

export function removeBlock(doc: EmailDocument, id: string): EmailDocument {
  return { ...doc, blocks: doc.blocks.filter((block) => block.id !== id || Boolean(block.lock)) };
}

export function replaceBlock(doc: EmailDocument, block: EmailBlock): EmailDocument {
  return { ...doc, blocks: doc.blocks.map((item) => (item.id === block.id ? block : item)) };
}

export function canMove(doc: EmailDocument, id: string, direction: -1 | 1, security: boolean): boolean {
  if (security) return false;
  const index = doc.blocks.findIndex((block) => block.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= doc.blocks.length) return false;
  // The title stays first (an email without a title block can move every block).
  if (doc.blocks[0]?.type === "heading" && (index === 0 || target === 0)) return false;
  return true;
}

/** One line describing a block in the list (values by label). */
export function blockSummary(block: EmailBlock, valueLabel: (name: string) => string): string {
  const text = (value: Inline) => value.map((segment) => (segment.kind === "text" ? segment.text : `[${valueLabel(segment.name)}]`)).join("").replace(/\s+/g, " ").trim();
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "note":
      return text(block.text) || "Empty";
    case "callout":
      return text(block.text) || "Empty";
    case "details":
      return block.rows.map((row) => row.label || "No label").join(" · ");
    case "lineItems":
      return `Filled by the system: ${valueLabel(block.source)}`;
    case "button":
      return `${block.label} → ${valueLabel(block.link)}${block.labelValue ? " (or the sender's label)" : ""}`;
    case "photos":
      return `Photos: ${valueLabel(block.source)}`;
    case "code":
      return `Code: ${valueLabel(block.source)}`;
    case "signature":
      return text(block.name) || "Empty";
    case "divider":
      return "Thin line";
  }
}

/** The value set for the preview: a sample, optionally with values removed to show what a missing value does. */
export function previewValues(definition: EmailDesignDefinition, sampleId: string, missing: boolean): Record<string, string> {
  const sample = definition.samples.find((item) => item.id === sampleId) ?? definition.samples[0];
  if (!missing) return sample.values;
  const keep = new Set(["companyName", "appUrl", "loginUrl", "supportEmail", "currentDate"]);
  return Object.fromEntries(Object.entries(sample.values).map(([name, value]) => [name, keep.has(name) ? value : ""]));
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
