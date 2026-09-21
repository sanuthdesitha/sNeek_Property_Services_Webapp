import { z } from "zod";

export const photoMemoryKey = (propertyId: string) => `ai_photo_memory:${propertyId}`;
const schema = z.object({ excludedMediaIds: z.array(z.string().min(1).max(200)).max(1000) }).strict();
/** A corrupt exclusion record fails closed, rather than restoring unwanted examples. */
export function parsePhotoMemoryExclusions(value: unknown): string[] {
  return value == null ? [] : Array.from(new Set(schema.parse(value).excludedMediaIds));
}
