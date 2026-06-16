import type { ServiceChecklist } from "./types";
import type { FormField, FormSchema, FormSection } from "@/lib/forms/types";

/**
 * Build an editable job-form schema from a service checklist. Each COVERED
 * checklist item becomes a "done" checkbox field carrying the same label, the
 * how-to instructions, and any how-to video — so the generated form matches the
 * checklist by construction. Not-covered items are exclusions (shown on the
 * quote), so they're skipped here. Admins can then tweak the form in the builder.
 */
export function checklistToFormSchema(checklist: ServiceChecklist): FormSchema {
  const sections: FormSection[] = checklist.sections
    .map((section) => {
      const fields: FormField[] = section.items
        .filter((item) => item.covered)
        .map((item) => ({
          id: item.id,
          type: "checkbox",
          label: item.label,
          required: false,
          instructions: item.instructions?.trim() || undefined,
          references: item.videoUrl?.trim()
            ? [{ kind: "video" as const, url: item.videoUrl.trim(), caption: "How-to video" }]
            : undefined,
        }));
      return { id: section.id, title: section.title, fields } satisfies FormSection;
    })
    .filter((section) => section.fields.length > 0);

  return { sections };
}
