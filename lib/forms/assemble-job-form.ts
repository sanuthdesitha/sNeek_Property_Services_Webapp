import type { JobAdditional } from "@/lib/jobs/meta";
import { normalizeFormSchema } from "@/lib/forms/normalize-schema";
import { stripHtmlToText } from "@/lib/forms/sanitize";

/** Assemble once from the selected normal or generated rework schema. */
export function assembleJobForm(schema: unknown, additionals: readonly JobAdditional[] = []) {
  const base = schema && typeof schema === "object" ? schema as Record<string, unknown> : {};
  if (additionals.length === 0) return normalizeFormSchema(base);
  const sections = Array.isArray(base.sections) ? base.sections : [];
  return normalizeFormSchema({
    ...base,
    sections: [...sections, {
      id: "additionals",
      title: "Additionals (client-requested)",
      description: "Extra work added on the quote for this job.",
      fields: additionals.map((extra) => ({
        id: extra.id,
        type: "checkbox",
        label: stripHtmlToText(extra.label),
        required: false,
        instructions: extra.instructions ? stripHtmlToText(extra.instructions) : undefined,
      })),
    }],
  });
}
