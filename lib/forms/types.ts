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
