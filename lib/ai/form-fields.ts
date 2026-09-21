import { isTemplateNodeVisible } from "@/lib/forms/visibility";
import { isUploadFieldType } from "@/lib/forms/field-types";
export type VisionFormField = { id: string; label: string; sectionLabel: string; referenceKeys: string[]; imageCapable: boolean; maxFiles?: number };
/** Caller supplies only the canonical resolved template and authorized property projection. */
export function deriveVisionFields(schema: unknown, answers: Record<string, unknown>, property: Record<string, unknown>, laundryReady = false): VisionFormField[] {
  const fields: VisionFormField[] = [];
  function visit(node: any, parentVisible = true, section = "") {
    if (!node || typeof node !== "object") return;
    const visible = parentVisible && isTemplateNodeVisible(node, answers, property, laundryReady);
    const sectionLabel = Array.isArray(node.fields) ? String(node.title ?? node.label ?? section).slice(0, 300) : section;
    if (visible && typeof node.id === "string" && typeof node.type === "string") fields.push({
      id: node.id, label: String(node.label ?? node.id).slice(0, 300), sectionLabel,
      imageCapable: isUploadFieldType(node.type) && (node.type === "file" || node.mediaMode === "both" || (node.type === "photo" && node.mediaMode !== "video")),
      ...(Number(node.maxFiles) > 0 ? { maxFiles: Number(node.maxFiles) } : {}),
      referenceKeys: (Array.isArray(node.references) ? node.references : []).filter((ref: any) => ref?.kind === "image" && typeof ref.storageKey === "string" && ref.storageKey.startsWith("form-references/") && !/[\\\u0000-\u0020]/.test(ref.storageKey) && !ref.storageKey.split("/").some((part: string) => !part || part === ".." || part === ".")).map((ref: any) => ref.storageKey).slice(0, 2),
    });
    for (const key of ["sections", "fields", "children"]) if (Array.isArray(node[key])) node[key].forEach((child: any) => visit(child, visible, sectionLabel));
  }
  visit(schema);
  return fields;
}
