// Zod validation for FormTemplate.schema JSON. Intentionally permissive
// (passthrough) so legacy templates and forward-compatible props keep saving;
// it only enforces the structural invariants every renderer relies on:
// sections is an array, every section/field has a string id, fields is an
// array, and sub-fields (children) are one level deep with the same shape.

import { z } from "zod";

const conditionZ = z
  .object({
    fieldId: z.string().optional(),
    propertyField: z.string().optional(),
    operator: z.string().optional(),
    value: z.unknown().optional(),
    equals: z.unknown().optional(),
  })
  .passthrough();

const childFieldZ = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    label: z.string(),
    required: z.boolean().optional(),
    conditional: conditionZ.optional(),
  })
  .passthrough();

const fieldZ = childFieldZ.extend({
  // One level deep only: children may not have children of their own.
  children: z
    .array(childFieldZ.refine((c: any) => !Array.isArray(c.children) || c.children.length === 0, {
      message: "Sub-fields cannot have their own sub-fields (one level deep only).",
    }))
    .optional(),
});

const sectionZ = z
  .object({
    id: z.string().min(1),
    // Legacy templates use `label`, the modern builder uses `title` — one of
    // the two must exist but neither is individually required.
    title: z.string().optional(),
    label: z.string().optional(),
    description: z.string().optional(),
    conditional: conditionZ.optional(),
    fields: z.array(fieldZ),
  })
  .passthrough();

// Optional appearance overrides (schema.theme). All fields optional so legacy
// templates and forward-compatible props keep validating; passthrough lets new
// theme keys land without a schema bump.
const themeZ = z
  .object({
    accentColor: z.string().optional(),
    headerColor: z.string().optional(),
    logoUrl: z.string().optional(),
    logoKey: z.string().optional(),
    showDividers: z.boolean().optional(),
    headingFont: z.string().optional(),
    bodyFont: z.string().optional(),
  })
  .passthrough();

export const formTemplateSchemaZ = z
  .object({
    sections: z.array(sectionZ),
    theme: themeZ.optional(),
  })
  .passthrough();

export type ValidatedFormTemplateSchema = z.infer<typeof formTemplateSchemaZ>;
