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
  | "instruction"
  // structured (see lib/forms/structured-answers.ts)
  | "table"
  | "stock_count";

export type FieldConditionOperator =
  | "equals"
  | "notEquals"
  | "answered"
  | "notAnswered"
  // multi-value (multiselect / checkbox group) membership, or substring for text
  | "contains"
  | "notContains"
  | "oneOf"
  | "gt"
  | "lt";

/** Show/hide rule that watches another question's answer. */
export interface FieldCondition {
  fieldId: string;
  operator?: FieldConditionOperator;
  // `value` is used by the operator forms. `equals` is the legacy shape and is
  // treated as operator:"equals" when no operator is given.
  value?: unknown;
  equals?: unknown;
}

/**
 * Show/hide rule that reads the job's property instead of an answer
 * ("if property has a balcony"). `propertyField` must be one of the
 * cleaner-visible keys in lib/forms/job-form-property.ts
 * (`jobFormPropertySelect`); any other key fails closed at read time and is
 * refused when a draft is saved. Compared with `templateValuesEqual`
 * (lib/forms/visibility.ts): equality only.
 */
export interface PropertyFieldCondition {
  propertyField: string;
  operator?: "equals";
  value?: unknown;
  /** Legacy operand key written by older checklist generators. */
  equals?: unknown;
}

/** Any stored show/hide rule on a section or question. */
export type FormCondition = FieldCondition | PropertyFieldCondition;

export function isPropertyFieldCondition(condition: FormCondition | null | undefined): condition is PropertyFieldCondition {
  return Boolean(condition) && typeof (condition as PropertyFieldCondition).propertyField === "string";
}

export function isAnswerCondition(condition: FormCondition | null | undefined): condition is FieldCondition {
  return Boolean(condition) && typeof (condition as FieldCondition).fieldId === "string";
}

/**
 * How often a question is asked (emitted by lib/checklists/compose.ts and read
 * by lib/accountability/rotation-schema.ts):
 *  - absent / "EVERY_CLEAN": every job;
 *  - "ROTATIONAL": only when due, every `rotationEveryNCleans` completed cleans
 *    of the property (filtered at read time, tracked per property);
 *  - "CONDITIONAL": generated from the checklist library; shown when the
 *    matching exception is reported (its `conditional` carries the rule);
 *  - "MONTHLY": calendar cadence — shown on the first clean of each calendar
 *    month at the property (organisation timezone), judged from the
 *    property's last-shown date for the question
 *    (`PropertyRotationState.lastCompletedAt`, see
 *    lib/accountability/rotation-schema.ts).
 */
export type FieldFrequency = "EVERY_CLEAN" | "ROTATIONAL" | "CONDITIONAL" | "MONTHLY";

/** Smallest and largest "every Nth clean" the builder offers. */
export const ROTATION_MIN_CLEANS = 2;
export const ROTATION_MAX_CLEANS = 12;

/**
 * Per-room repeat of a section: the section is shown once per bedroom or
 * bathroom of the job's property (lib/forms/repeat-sections.ts expands it at
 * read time; ids gain `__bedN` / `__bathN`, the suffix the rotation tracker
 * already strips).
 */
export type SectionRepeatBy = "bedrooms" | "bathrooms";

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

/* ── Table question ("table") ─────────────────────────────────────────────
 * Answer shape: an array of row objects keyed by column id, e.g.
 * [{ "c1": "Fridge", "c2": 3, "c3": true }]. Fixed rows answer row i of
 * `rowLabels`; "cleaner can add rows" lets the cleaner add between
 * `minRows` and `maxRows` rows. Validated by lib/forms/structured-answers.ts.
 */
export type TableCellType = "text" | "number" | "yesno" | "choice";

export interface TableColumn {
  id: string;
  label: string;
  cellType: TableCellType;
  required?: boolean;
  /** Choice cells only. */
  options?: string[];
}

export interface TableConfig {
  columns: TableColumn[];
  rowMode: "fixed" | "dynamic";
  /** Fixed rows: one label per row, shown to the cleaner. */
  rowLabels?: string[];
  /** "Cleaner can add rows": limits on how many rows. */
  minRows?: number;
  maxRows?: number;
}

/** Answer of a "stock_count" question: the item counted and how many are there. */
export interface StockCountAnswer {
  itemId: string;
  count: number;
}

/* ── Question effects ─────────────────────────────────────────────────────
 * What submitting an answer does beyond storing it. Each effect runs through
 * an existing service (lib/forms/form-effects.ts):
 *  - "urgent-stock-below" (Stock count only): a count below `threshold`
 *    raises an urgent stock NEED through lib/inventory/urgent-stock.ts once per
 *    submission and item. It orders nothing.
 *  - "damage-report" (Yes / No only): the answer `when` prompts the cleaner
 *    into the job's damage report; if none is submitted, the submit route
 *    opens the private damage case it already opens for reported damage.
 */
export interface UrgentStockEffect {
  kind: "urgent-stock-below";
  threshold: number;
}

export interface DamageReportEffect {
  kind: "damage-report";
  when: "yes" | "no";
  /** Prefilled area / room; falls back to the question's location tag or section. */
  area?: string;
  /** Prefilled damage category. */
  category?: string;
}

export type FieldEffect = UrgentStockEffect | DamageReportEffect;

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  helpText?: string;
  // Longer "how to clean this" instructions revealed in a popup (text shown
  // alongside reference images/video). Distinct from the short inline helpText.
  instructions?: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
  // Free-text area label ("Kitchen", "Bathroom 2"). Used for grouping in the
  // guided capture flow and per-area rollups in form statistics.
  locationTag?: string;
  // Priority flag surfaced to the cleaner and weighted in stats.
  severity?: FieldSeverity;
  // Evidence taxonomy carried through from the checklist library item
  // (LIVING | KITCHEN | BATHROOM | BEDROOM | OUTDOOR | FINAL | PROPERTY_CONFIRM
  // | LAUNDRY_CONFIRM). Drives QA grouping + missing-mandatory-evidence scoring.
  evidenceCategory?: string;
  // yes/no: when answered "No", a details note (stored as `${id}_details` in
  // the submission data) becomes required.
  detailsWhenNo?: boolean;
  // Sub-fields rendered indented under this field (one level deep). They take
  // part in visibility, validation, and stats like any other field.
  children?: FormField[];
  // media
  minPhotos?: number;
  maxFiles?: number;
  // NOTE: there is deliberately no `maxDurationSec`. The builder used to collect
  // a max video length but no capture path enforced it, so the setting was
  // removed; normalizeFormSchema drops the key from stored templates.
  // Capture type for media/upload fields. Only meaningful when type is
  // "photo" or "video". "both" lets the cleaner capture photos AND videos for
  // the same field (offers both capture buttons + the in-app recorder).
  // When unset it follows field.type (photo => photo, video => video).
  mediaMode?: "photo" | "video" | "both";
  // Evidence stamp tag burned into the top-left chip of every photo captured
  // for this field ("before" / "after" / "damage", or a custom label). When
  // unset (or "auto") the cleaner app derives it from the section/field wording.
  stampTag?: "before" | "after" | "damage" | string;
  // numeric / slider / scale / counter
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  // choice enhancements
  allowOther?: boolean;
  searchable?: boolean;
  // Explicit truthful device status / exception control.
  deviceStatus?: boolean;
  // yes/no
  includeNa?: boolean;
  // reference/example media shown to the person filling the form
  references?: FormFieldReference[];
  // When this field has reference example images and is ticked/answered
  // positively, surface the example media as a popup/inline preview. Defaults
  // to true when references exist; set false to keep references collapsed.
  showExampleOnTick?: boolean;
  /** Optional acceptance criteria for the AI photo check of this field (office only; never shown to cleaners). */
  aiCriteria?: string;
  // logic + scoring
  conditional?: FormCondition;
  scoring?: { weight: number; max: number };
  // cadence (see FieldFrequency)
  frequency?: FieldFrequency;
  /** With frequency "ROTATIONAL": due every N completed cleans. */
  rotationEveryNCleans?: number;
  /** "table" questions: columns and rows. */
  table?: TableConfig;
  /** "stock_count" questions: the inventory item counted (InventoryItem id). */
  stockItemId?: string;
  /** "stock_count": the item's name when it was chosen (display only). */
  stockItemName?: string;
  /** What submitting this answer does (see FieldEffect). */
  effects?: FieldEffect[];
}

export interface FormSection {
  id: string;
  title: string;
  description?: string;
  collapsible?: boolean;
  conditional?: FormCondition;
  /** Repeat this section once per bedroom / bathroom of the property. */
  repeatBy?: SectionRepeatBy;
  fields: FormField[];
}

export interface FormSchema {
  sections: FormSection[];
  /** Optional appearance overrides for the form body (see FormTheme). */
  theme?: FormTheme;
  /**
   * Template-level inventory capture config (R8a): which PropertyStock items
   * the hardcoded "Stock & consumables used" block offers. Absent / mode "all"
   * = every stocked item; mode "selected" = only `itemIds` (empty = none).
   * See lib/forms/inventory-config.ts.
   */
  inventoryConfig?: { mode: "all" | "selected"; itemIds: string[] };
  /**
   * Template-owned standard sections opt-out. `false` = the arrival-evidence /
   * reported-exceptions / sign-off sections are already baked into `sections`
   * and must NOT be re-injected at read time (see lib/forms/standard-sections).
   * `undefined` keeps the historical injection so un-migrated templates keep
   * their evidence gates.
   */
  standardSections?: boolean;
}
