/**
 * "Documents and additional details": the files and answers captured when the
 * property was created — access photos and PDFs (`accessInfo.attachments`) and
 * the admin-defined custom intake fields (`Property.customFields`, labelled by
 * the property form configuration). Pure.
 */
import type { CustomFieldDef } from "@/lib/property-form/config";
import type { DetailItem, DocumentItem } from "./preview-types";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function fileNameOf(url: string, fallback: string): string {
  const last = url.split("?")[0]?.split("/").pop();
  try {
    return last ? decodeURIComponent(last) : fallback;
  } catch {
    return last || fallback;
  }
}

function answerText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" || typeof value === "string") return String(value);
  return null;
}

export function documentsAndDetails(
  accessInfo: unknown,
  customFields: unknown,
  definitions: readonly CustomFieldDef[],
): { documents: DocumentItem[]; details: DetailItem[] } {
  const documents: DocumentItem[] = [];
  const attachments = record(accessInfo).attachments;
  if (Array.isArray(attachments)) {
    for (const entry of attachments) {
      const file = record(entry);
      if (typeof file.url !== "string" || !file.url) continue;
      const name = typeof file.name === "string" && file.name.trim() ? file.name.trim() : fileNameOf(file.url, "Access file");
      documents.push({ label: "Access", name, url: file.url, source: "access" });
    }
  }

  const values = record(customFields);
  const details: DetailItem[] = [];
  for (const definition of definitions) {
    const value = values[definition.id];
    if (definition.type === "photo" || definition.type === "file") {
      const media = record(value);
      if (typeof media.url === "string" && media.url) {
        documents.push({ label: definition.label, name: fileNameOf(media.url, definition.label), url: media.url, source: "intake" });
      }
      continue;
    }
    const text = answerText(value);
    if (text !== null) details.push({ label: definition.label, value: text });
  }
  return { documents, details };
}
