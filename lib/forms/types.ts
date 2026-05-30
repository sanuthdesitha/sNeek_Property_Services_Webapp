// sneek-ops-dashboard – Form template schema types
// Used by the seed library, the form builder, and every renderer.

export type FormFieldType =
  // basic
  | "text"
  | "longtext"
  | "number"
  | "email"
  | "phone"
  | "currency"
  | "date"
  | "time"
  | "datetime"
  // choice
  | "select"
  | "multiselect"
  | "checkbox"
  | "radio"
  | "yesno"
  // scale
  | "rating"
  | "slider"
  | "counter"
  | "scale"
  // media
  | "photo"
  | "video"
  | "file"
  | "signature"
  // advanced
  | "location"
  | "instruction";

export type FieldConditionOperator =
  | "equals"
  | "notEquals"
  | "answered"
  | "notAnswered"
  | "oneOf"
  | "gt"
  | "lt";

export interface FieldCondition {
  fieldId: string;
  operator?: FieldConditionOperator;
  // `value` is used by the operator forms. `equals` is the legacy shape and is
  // treated as operator:"equals" when no operator is given.
  value?: unknown;
  equals?: unknown;
}

export type FormFieldReferenceKind = "image" | "video" | "link";

export interface FormFieldReference {
  kind: FormFieldReferenceKind;
  // External URL, or a resolved (presigned/public) URL for an uploaded file.
  url: string;
  // S3 key when the reference was uploaded; resolved to a presigned GET URL at
  // render time. External links leave this undefined.
  storageKey?: string;
  caption?: string;
}

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  helpText?: string;
  required?: boolean;
  options?: string[];
  // media
  minPhotos?: number;
  maxFiles?: number;
  // numeric / slider / scale / counter
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  // choice enhancements
  allowOther?: boolean;
  searchable?: boolean;
  // yes/no
  includeNa?: boolean;
  // reference/example media shown to the person filling the form
  references?: FormFieldReference[];
  // logic + scoring
  conditional?: FieldCondition;
  scoring?: { weight: number; max: number };
}

export interface FormSection {
  id: string;
  title: string;
  description?: string;
  collapsible?: boolean;
  conditional?: FieldCondition;
  fields: FormField[];
}

export interface FormSchema {
  sections: FormSection[];
}
