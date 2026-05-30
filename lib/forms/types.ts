// sneek-ops-dashboard – Form template schema types
// Used by the seed library and (later) the drag-drop form builder.

export type FormFieldType =
  | "text"
  | "longtext"
  | "number"
  | "select"
  | "multiselect"
  | "checkbox"
  | "radio"
  | "photo"
  | "video"
  | "signature"
  | "rating"
  | "time"
  | "date";

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  helpText?: string;
  required?: boolean;
  options?: string[];
  minPhotos?: number;
  conditional?: { fieldId: string; equals: unknown };
  scoring?: { weight: number; max: number };
}

export interface FormSection {
  id: string;
  title: string;
  description?: string;
  collapsible?: boolean;
  fields: FormField[];
}

export interface FormSchema {
  sections: FormSection[];
}

// Field types that represent media uploads (camera / file picker UI).
// `"upload"` is kept as a back-compat alias for templates that may have been
// authored with the older type name; canonical schema uses `photo` / `video`.
// Signatures are NOT included — they're an inline canvas widget, not an upload.
export function isUploadFieldType(value: unknown): boolean {
  return value === "photo" || value === "video" || value === "upload";
}
