// Central registry of form field types. One entry per type declares the
// metadata every other layer needs (builder picker, builder editor, renderers,
// report/admin value formatting). Adding a new field type should mean adding a
// registry entry plus a render branch in components/forms/field-input.tsx —
// not editing eight files.
//
// IMPORTANT: this module is imported by both client components AND server code
// (the report generator). Keep it pure — no "server-only", no DOM, no React.
// Icons are stored as lucide-react icon *names* (resolved in client components)
// so the server can import this safely.

import type { FormField, FormFieldType } from "./types";

export type FieldCategory = "basic" | "choice" | "scale" | "media" | "advanced";

export interface FieldValueFormatContext {
  // Number of uploaded media files for this field (callers compute from the
  // submission). Only meaningful for upload field types.
  mediaCount?: number;
}

export interface FieldTypeDef {
  type: FormFieldType;
  label: string;
  /** lucide-react icon name */
  icon: string;
  category: FieldCategory;
  /** Renders options list (select/multiselect/radio). */
  hasOptions?: boolean;
  /** Routes to the "Uploads" step + camera/file UI on the cleaner form. */
  isUpload?: boolean;
  /** Read-only display block — collects no answer. */
  isReadOnly?: boolean;
  /** Supports numeric range config (min/max/step/unit). */
  hasRange?: boolean;
  /** Can carry a QA scoring weight. */
  scorable?: boolean;
  /** Default config applied when the field is first added in the builder. */
  defaultConfig?: Partial<FormField>;
  /** Text representation for reports / admin job view. */
  formatValue: (field: FormField, value: unknown, ctx?: FieldValueFormatContext) => string;
}

const EMPTY = "-";

function fmtBoolean(value: unknown): string {
  if (value === true || value === "true") return "Yes";
  if (value === false || value === "false") return "No";
  return EMPTY;
}

function fmtScalar(value: unknown): string {
  if (value === undefined || value === null || value === "") return EMPTY;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.join(", ") : EMPTY;
  return String(value);
}

function fmtNumberWithUnit(field: FormField, value: unknown): string {
  if (value === undefined || value === null || value === "") return EMPTY;
  const num = Number(value);
  if (!Number.isFinite(num)) return fmtScalar(value);
  return field.unit ? `${num} ${field.unit}` : String(num);
}

function fmtUpload(_field: FormField, _value: unknown, ctx?: FieldValueFormatContext): string {
  const count = ctx?.mediaCount ?? 0;
  return count > 0 ? `${count} file(s)` : "Not uploaded";
}

export const FIELD_TYPES: Record<FormFieldType, FieldTypeDef> = {
  // ---- basic ----
  text: { type: "text", label: "Text", icon: "Type", category: "basic", formatValue: (_f, v) => fmtScalar(v) },
  longtext: { type: "longtext", label: "Long text", icon: "AlignLeft", category: "basic", formatValue: (_f, v) => fmtScalar(v) },
  number: { type: "number", label: "Number", icon: "Hash", category: "basic", hasRange: true, scorable: true, formatValue: fmtNumberWithUnit },
  email: { type: "email", label: "Email", icon: "Mail", category: "basic", formatValue: (_f, v) => fmtScalar(v) },
  phone: { type: "phone", label: "Phone", icon: "Phone", category: "basic", formatValue: (_f, v) => fmtScalar(v) },
  currency: {
    type: "currency",
    label: "Currency",
    icon: "DollarSign",
    category: "basic",
    formatValue: (_f, v) => {
      if (v === undefined || v === null || v === "") return EMPTY;
      const num = Number(v);
      return Number.isFinite(num) ? `$${num.toFixed(2)}` : fmtScalar(v);
    },
  },
  date: { type: "date", label: "Date", icon: "Calendar", category: "basic", formatValue: (_f, v) => fmtScalar(v) },
  time: { type: "time", label: "Time", icon: "Clock", category: "basic", formatValue: (_f, v) => fmtScalar(v) },
  datetime: { type: "datetime", label: "Date & time", icon: "CalendarClock", category: "basic", formatValue: (_f, v) => fmtScalar(v) },

  // ---- choice ----
  select: { type: "select", label: "Dropdown", icon: "ChevronDown", category: "choice", hasOptions: true, scorable: true, formatValue: (_f, v) => fmtScalar(v) },
  multiselect: { type: "multiselect", label: "Multi-select", icon: "ListChecks", category: "choice", hasOptions: true, scorable: true, formatValue: (_f, v) => fmtScalar(v) },
  checkbox: { type: "checkbox", label: "Checkbox", icon: "CheckSquare", category: "choice", scorable: true, formatValue: (_f, v) => fmtBoolean(v) },
  radio: { type: "radio", label: "Radio", icon: "CircleDot", category: "choice", hasOptions: true, scorable: true, formatValue: (_f, v) => fmtScalar(v) },
  yesno: {
    type: "yesno",
    label: "Yes / No",
    icon: "ToggleLeft",
    category: "choice",
    scorable: true,
    formatValue: (_f, v) => {
      if (v === "na" || v === "NA" || v === "N/A") return "N/A";
      return fmtBoolean(v);
    },
  },

  // ---- scale ----
  rating: { type: "rating", label: "Star rating", icon: "Star", category: "scale", hasRange: true, scorable: true, formatValue: fmtNumberWithUnit },
  slider: { type: "slider", label: "Slider", icon: "SlidersHorizontal", category: "scale", hasRange: true, scorable: true, defaultConfig: { min: 0, max: 10, step: 1 }, formatValue: fmtNumberWithUnit },
  counter: { type: "counter", label: "Counter", icon: "Plus", category: "scale", hasRange: true, scorable: true, defaultConfig: { min: 0, step: 1 }, formatValue: fmtNumberWithUnit },
  scale: { type: "scale", label: "Scale (1–N)", icon: "Gauge", category: "scale", hasRange: true, scorable: true, defaultConfig: { min: 1, max: 5, step: 1 }, formatValue: fmtNumberWithUnit },

  // ---- media ----
  photo: { type: "photo", label: "Photo", icon: "Camera", category: "media", isUpload: true, scorable: true, defaultConfig: { minPhotos: 1 }, formatValue: fmtUpload },
  video: { type: "video", label: "Video", icon: "Video", category: "media", isUpload: true, formatValue: fmtUpload },
  file: { type: "file", label: "Document / file", icon: "FileText", category: "media", isUpload: true, formatValue: fmtUpload },
  signature: { type: "signature", label: "Signature", icon: "PenLine", category: "media", formatValue: (_f, v) => (typeof v === "string" && v.startsWith("data:image/") ? "Signed" : EMPTY) },

  // ---- measurement / scanning ----
  temperature: {
    type: "temperature",
    label: "Temperature",
    icon: "Thermometer",
    category: "scale",
    hasRange: true,
    scorable: true,
    defaultConfig: { unit: "°C", step: 0.5 },
    formatValue: fmtNumberWithUnit,
  },
  barcode: {
    type: "barcode",
    label: "Barcode / QR scan",
    icon: "QrCode",
    category: "advanced",
    formatValue: (_f, v) => fmtScalar(v),
  },

  // ---- advanced ----
  location: {
    type: "location",
    label: "GPS location",
    icon: "MapPin",
    category: "advanced",
    formatValue: (_f, v) => {
      if (v && typeof v === "object" && "lat" in (v as any) && "lng" in (v as any)) {
        const { lat, lng } = v as { lat: number; lng: number };
        return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
      }
      return fmtScalar(v);
    },
  },
  instruction: { type: "instruction", label: "Instruction / info", icon: "Info", category: "advanced", isReadOnly: true, formatValue: () => EMPTY },
};

export const FIELD_CATEGORY_LABELS: Record<FieldCategory, string> = {
  basic: "Basic",
  choice: "Choice",
  scale: "Scale & rating",
  media: "Media",
  advanced: "Advanced",
};

export const FIELD_CATEGORY_ORDER: FieldCategory[] = ["basic", "choice", "scale", "media", "advanced"];

export function getFieldTypeDef(type: string | undefined | null): FieldTypeDef | undefined {
  if (!type) return undefined;
  return FIELD_TYPES[type as FormFieldType];
}

/** Field types that represent media uploads (camera / file picker UI). */
export function isUploadFieldType(value: unknown): boolean {
  // "upload" is a legacy alias for templates authored before photo/video/file.
  if (value === "upload") return true;
  const def = getFieldTypeDef(typeof value === "string" ? value : undefined);
  return Boolean(def?.isUpload);
}

export function fieldHasOptions(type: string | undefined | null): boolean {
  return Boolean(getFieldTypeDef(type)?.hasOptions);
}

export function isReadOnlyFieldType(type: string | undefined | null): boolean {
  return Boolean(getFieldTypeDef(type)?.isReadOnly);
}

/** Text representation of a field's answer for reports / admin display. */
export function formatFieldValue(field: FormField, value: unknown, ctx?: FieldValueFormatContext): string {
  const def = getFieldTypeDef(field?.type);
  if (def) return def.formatValue(field, value, ctx);
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
