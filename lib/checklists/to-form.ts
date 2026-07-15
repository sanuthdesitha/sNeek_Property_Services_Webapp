import type { ServiceChecklist } from "./types";
import type { FormField, FormFieldReference, FormSchema, FormSection } from "@/lib/forms/types";
import { withStandardSections } from "./compose";

/**
 * Build an editable job-form schema from a service checklist. Each COVERED
 * checklist item becomes a "done" checkbox field carrying the same label, the
 * how-to instructions, any reference image/video, and — when the item is flagged
 * `requiresPhoto` — a required proof-photo sub-field (shown once the task is
 * ticked, enforced by the existing required-upload validation). Not-covered
 * items are exclusions (shown on the quote), so they're skipped here. A standard
 * "Arrival evidence" section (walkthrough video + before photos) is prepended and
 * a signature "Sign-off" section appended by default. Admins can then tweak the
 * form in the builder.
 */
export function checklistToFormSchema(checklist: ServiceChecklist): FormSchema {
  const sections: FormSection[] = checklist.sections
    .map((section) => {
      const fields: FormField[] = section.items
        .filter((item) => item.covered)
        .map((item) => {
          const references: FormFieldReference[] = [];
          if (item.imageUrl?.trim()) {
            references.push({ kind: "image", url: item.imageUrl.trim(), caption: "Reference" });
          }
          if (item.videoUrl?.trim()) {
            references.push({ kind: "video", url: item.videoUrl.trim(), caption: "How-to video" });
          }
          const field: FormField = {
            id: item.id,
            type: "checkbox",
            label: item.label,
            required: false,
            instructions: item.instructions?.trim() || undefined,
            references: references.length > 0 ? references : undefined,
          };
          if (item.requiresPhoto) {
            field.children = [
              {
                id: `${item.id}__proof`,
                type: "photo",
                label: `Proof photo — ${item.label}`,
                required: true,
                minPhotos: 1,
                stampTag: "after",
                conditional: { fieldId: item.id, operator: "equals", value: true },
              },
            ];
          }
          return field;
        });
      return { id: section.id, title: section.title, fields } satisfies FormSection;
    })
    .filter((section) => section.fields.length > 0);

  return { sections: withStandardSections(sections) as FormSection[] };
}
