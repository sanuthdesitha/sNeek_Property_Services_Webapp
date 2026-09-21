import "server-only";
import { z } from "zod";
import type { VisionImage } from "./vision";
function recognitionConfiguration() {
  const raw = process.env.MODEL_SERVICE_URL?.trim(); const token = process.env.MODEL_SERVICE_TOKEN?.trim();
  if (!raw || !token || token.length < 24) return { configured: false as const };
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return { configured: false as const };
    return { configured: true as const, url: url.toString().replace(/\/$/, ""), token };
  } catch { return { configured: false as const }; }
}
export function getRecognitionConfiguration() { return { configured: recognitionConfiguration().configured }; }
async function request(propertyId: string, operation: "train" | "predict", body: unknown) {
  const config = recognitionConfiguration();
  if (!config.configured || !propertyId || propertyId.length > 200) throw new Error("Property recognition service is unavailable.");
  try {
    const response = await fetch(`${config.url}/v1/properties/${encodeURIComponent(propertyId)}/${operation}`, { method: "POST", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(operation === "train" ? 600_000 : 30_000) });
    if (!response.ok) throw new Error("Unavailable");
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > 1024 * 1024) throw new Error("Oversized response");
    if (!response.body) throw new Error("Missing response");
    const reader = response.body.getReader(); let text = "", size = 0; const decoder = new TextDecoder();
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 1024 * 1024) throw new Error("Oversized response"); text += decoder.decode(chunk.value, { stream: true }); } text += decoder.decode(); }
    finally { await reader.cancel().catch(() => undefined); }
    return JSON.parse(text);
  } catch { throw new Error("Property recognition service is unavailable. Try again later."); }
}
const assignmentSchema = z.object({ photoId: z.string(), fieldId: z.string().nullable(), confidence: z.number().finite().min(0).max(1), reason: z.string().max(1000) }).strict();
export async function predictPropertyRecognition(input: { propertyId: string; revision: string; modelVersion: string; photos: VisionImage[]; fields: { id: string; label: string; sectionLabel: string }[] }) {
  if (!getRecognitionConfiguration().configured) return null;
  try {
    const result = z.object({ trained: z.boolean(), modelVersion: z.string().max(200).optional(), assignments: z.array(assignmentSchema).max(8) }).parse(await request(input.propertyId, "predict", { libraryRevision: input.revision, photos: input.photos, fields: input.fields }));
    if (!result.trained || result.modelVersion !== input.modelVersion || result.assignments.length !== input.photos.length || new Set(result.assignments.map(item => item.photoId)).size !== input.photos.length || result.assignments.some(item => !input.photos.some(photo => photo.id === item.photoId) || (item.fieldId !== null && !input.fields.some(field => field.id === item.fieldId)))) return null;
    return result;
  } catch { return null; }
}
export async function trainPropertyRecognition(input: { propertyId: string; revision: string; examples: { id: string; sectionId: string; fieldLabel: string; sectionLabel: string; jobId: string; image: VisionImage }[] }) {
  if (!input.examples.length || input.examples.length > 200) throw new Error("Training requires a bounded property photo library.");
  const labels = new Map<string, { id: string; label: string; sectionLabel: string }>(); let size = 0;
  for (const example of input.examples) {
    const label = { id: example.sectionId, label: example.fieldLabel, sectionLabel: example.sectionLabel };
    if (labels.has(label.id) && JSON.stringify(labels.get(label.id)) !== JSON.stringify(label)) throw new Error("Training labels changed. Refresh the property library.");
    labels.set(label.id, label); size += Buffer.byteLength(example.image.data, "base64");
  }
  if (size > 100 * 1024 * 1024 || labels.size > 100) throw new Error("Training library exceeds the supported size.");
  const body = { revision: input.revision, labels: Array.from(labels.values()), examples: input.examples.map(({ id, sectionId, jobId, image }) => ({ id, sectionId, jobId, image: { mediaType: image.mediaType, data: image.data } })) };
  try { return z.object({ status: z.enum(["promoted", "rejected", "insufficient_data"]), modelVersion: z.string().max(200).optional(), metrics: z.record(z.unknown()).optional(), reason: z.string().max(1000).optional() }).parse(await request(input.propertyId, "train", body)); }
  catch { throw new Error("Property recognition training could not finish. Retry when the service is available."); }
}
