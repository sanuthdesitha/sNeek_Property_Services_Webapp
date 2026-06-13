import type { FormField } from "@/lib/forms/types";

/**
 * Lightweight in-flow "divider line" building block. Backward-compatible: a
 * divider is just an `instruction` field whose label is this sentinel, so it
 * stores and validates exactly like any other instruction field and old
 * templates are unaffected. The shared renderer draws a horizontal rule for it
 * instead of the titled info box.
 */
export const DIVIDER_LABEL = "———";

export function isDividerField(field: Pick<FormField, "type" | "label"> | null | undefined): boolean {
  return (
    field?.type === "instruction" &&
    typeof field.label === "string" &&
    field.label.trim() === DIVIDER_LABEL
  );
}
