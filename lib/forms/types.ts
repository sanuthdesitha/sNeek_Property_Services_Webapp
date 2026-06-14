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
  // measurement / scanning
  | "temperature"
  | "barcode"
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

/**
 * Optional appearance overrides stored on the template schema as
 * `schema.theme`. Every field is optional and the form falls back to the app's
 * default tokens when absent — themes only ever affect the form body, never the
 * surrounding portal chrome. Colours are CSS colour strings (hex / rgb / hsl).
 */
export interface FormTheme {
  /** Primary action / tick / progress colour for the form body. */
  accentColor?: string;
  /** Colour for section heading text. */
  headerColor?: string;
  /** Resolved (presigned / public) logo URL shown at the top of the form. */
  logoUrl?: string;
  /** S3 key for an uploaded logo; resolved to `logoUrl` at render time. */
  logoKey?: string;
  /** Draw a divider line between sections. */
  showDividers?: boolean;
  /** Font family applied to section headings (CSS font-family value). */
  headingFont?: string;
  /** Body / answer text font family (CSS font-family value). */
  bodyFont?: string;
}

export type FieldSeverity = "low" | "medium" | "high";

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  helpText?: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
  // Free-text area label ("Kitchen", "Bathroom 2"). Used for grouping in the
  // guided capture flow and per-area rollups in form statistics.
  locationTag?: string;
  // Priority flag surfaced to the cleaner and weighted in stats.
  severity?: FieldSeverity;
  // yes/no: when answered "No", a details note (stored as `${id}_details` in
  // the submission data) becomes required.
  detailsWhenNo?: boolean;
  // Sub-fields rendered indented under this field (one level deep). They take
  // part in visibility, validation, and stats like any other field.
  children?: FormField[];
  // media
  minPhotos?: number;
  maxFiles?: number;
  // video: max recording length in seconds for in-app recording (default ~60).
  maxDurationSec?: number;
  // Capture type for media/upload fields. Only meaningful when type is
  // "photo" or "video". "both" lets the cleaner capture photos AND videos for
  // the same field (offers both capture buttons + the in-app recorder).
  // When unset it follows field.type (photo => photo, video => video).
  mediaMode?: "photo" | "video" | "both";
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
  // When this field has reference example images and is ticked/answered
  // positively, surface the example media as a popup/inline preview. Defaults
  // to true when references exist; set false to keep references collapsed.
  showExampleOnTick?: boolean;
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
  /** Optional appearance overrides for the form body (see FormTheme). */
  theme?: FormTheme;
}
