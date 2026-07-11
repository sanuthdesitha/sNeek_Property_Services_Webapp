/**
 * Configurable pricing variables — admin-defined adjustments that layer on top
 * of a base quote price (property condition, location/zone, parking, stairs,
 * pets, access, etc.). Stored in AppSettings JSON (no DB migration). Pure/typed:
 * no I/O, no framework imports.
 *
 * PERCENT SEMANTICS (documented):
 *   Every percent adjustment is applied to the ORIGINAL `base` amount, never to
 *   a running subtotal. Percents therefore do NOT compound with each other or
 *   with flat additions — order of variables is irrelevant and the breakdown is
 *   transparent. Final total = base + Σ(flat additions) + base × Σ(percent)/100.
 */

export type PricingAdjustType = "flat" | "percent" | "none";
export type PricingVariableKind = "select" | "boolean" | "number";

export interface PricingOption {
  id: string;
  label: string;
  adjustType: PricingAdjustType;
  /** Dollars for "flat", whole-number percent (20 = +20%) for "percent". */
  adjustValue: number;
}

export interface PricingVariable {
  id: string;
  label: string;
  kind: PricingVariableKind;
  required?: boolean;
  /** When true the operator may type an "other" value not in the option list. */
  allowCustom?: boolean;
  /** Default selection for select/boolean kinds. */
  defaultOptionId?: string;
  /** Selectable options for select/boolean kinds. */
  options?: PricingOption[];
  /** For number kind — how each entered unit adjusts the price. */
  unitAdjustType?: "flat" | "percent";
  unitAdjustValue?: number;
  unitLabel?: string;
  note?: string;
}

export interface PricingVariableLine {
  label: string;
  amount: number;
}

export interface PricingVariableResult {
  total: number;
  lines: PricingVariableLine[];
}

/** A single operator selection: option id (select/boolean), a quantity
 *  (number), a boolean, or a free-typed custom string. */
export type PricingSelectionValue = string | number | boolean;
export type PricingSelections = Record<string, PricingSelectionValue>;

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Apply the operator's selections against the configured variables to produce
 * an adjusted total plus a per-line breakdown that a quote can render.
 *
 * @param base        the pre-adjustment amount (typically the pre-GST subtotal)
 * @param variables   the admin-configured pricing variables (settings JSON)
 * @param selections  map of variable id → selected option id / quantity / value
 */
export function applyPricingVariables(
  base: number,
  variables: PricingVariable[],
  selections: PricingSelections
): PricingVariableResult {
  const lines: PricingVariableLine[] = [];
  const safeBase = Number.isFinite(base) ? base : 0;
  let flatTotal = 0;
  let percentTotal = 0; // whole-number percent points, applied to `safeBase`

  for (const variable of variables ?? []) {
    if (!variable || typeof variable.id !== "string") continue;
    const raw = selections?.[variable.id];

    /* ── number kind: quantity × per-unit adjustment ──────────────────── */
    if (variable.kind === "number") {
      const qty = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(qty) || qty === 0) continue;
      const unitType = variable.unitAdjustType ?? "flat";
      const unitValue = variable.unitAdjustValue ?? 0;
      if (!unitValue) continue;
      const unitSuffix = variable.unitLabel ? ` ${variable.unitLabel}` : "";
      const label = `${variable.label} (${qty}${unitSuffix})`;
      if (unitType === "percent") {
        const pct = qty * unitValue;
        percentTotal += pct;
        lines.push({ label, amount: round2((safeBase * pct) / 100) });
      } else {
        const amount = round2(qty * unitValue);
        flatTotal += amount;
        lines.push({ label, amount });
      }
      continue;
    }

    /* ── select / boolean kind: resolve to a configured option ────────── */
    const options = variable.options ?? [];
    let selectedId: string | undefined;
    if (raw === undefined || raw === null || raw === "") {
      selectedId = variable.defaultOptionId;
    } else if (typeof raw === "boolean") {
      // Accept a raw boolean for boolean-kind variables: false → default,
      // true → the first non-default option (falls back to default).
      selectedId = raw
        ? options.find((o) => o.id !== variable.defaultOptionId)?.id ?? variable.defaultOptionId
        : variable.defaultOptionId;
    } else {
      selectedId = String(raw);
    }

    const option = options.find((o) => o.id === selectedId);

    if (!option) {
      // Unmatched free-typed value → treat as a labelled custom entry with no
      // price impact (per spec: custom strings carry 0 adjust).
      if (variable.allowCustom && typeof raw === "string" && raw.trim()) {
        lines.push({ label: `${variable.label}: ${raw.trim()}`, amount: 0 });
      }
      continue;
    }

    if (option.adjustType === "none" || !option.adjustValue) continue;

    const label = `${variable.label}: ${option.label}`;
    if (option.adjustType === "percent") {
      percentTotal += option.adjustValue;
      lines.push({ label, amount: round2((safeBase * option.adjustValue) / 100) });
    } else {
      flatTotal += option.adjustValue;
      lines.push({ label, amount: round2(option.adjustValue) });
    }
  }

  const total = round2(safeBase + flatTotal + (safeBase * percentTotal) / 100);
  return { total, lines };
}

/**
 * Seed set of pricing variables. Also used as the settings default. Every
 * variable is fully editable/removable by an admin in the settings UI.
 */
export const DEFAULT_PRICING_VARIABLES: PricingVariable[] = [
  {
    id: "property_condition",
    label: "Property condition",
    kind: "select",
    required: true,
    defaultOptionId: "standard",
    options: [
      { id: "light", label: "Light", adjustType: "none", adjustValue: 0 },
      { id: "standard", label: "Standard", adjustType: "none", adjustValue: 0 },
      { id: "heavy", label: "Heavy", adjustType: "percent", adjustValue: 20 },
      { id: "very_heavy", label: "Very heavy", adjustType: "percent", adjustValue: 40 },
    ],
  },
  {
    id: "location_zone",
    label: "Location / zone",
    kind: "select",
    required: true,
    defaultOptionId: "standard",
    options: [
      { id: "standard", label: "Standard", adjustType: "none", adjustValue: 0 },
      { id: "outer", label: "Outer", adjustType: "flat", adjustValue: 20 },
      { id: "regional", label: "Regional", adjustType: "flat", adjustValue: 45 },
    ],
  },
  {
    id: "parking",
    label: "Parking",
    kind: "select",
    required: true,
    defaultOptionId: "free_onsite",
    options: [
      { id: "free_onsite", label: "Free on-site", adjustType: "none", adjustValue: 0 },
      { id: "free_street", label: "Free street", adjustType: "none", adjustValue: 0 },
      { id: "paid", label: "Paid parking", adjustType: "none", adjustValue: 0 },
    ],
  },
  {
    id: "paid_parking_coverage",
    label: "If paid parking, how is it covered?",
    kind: "select",
    defaultOptionId: "client_provides",
    note: "Shown when parking is set to paid.",
    options: [
      { id: "client_provides", label: "Client provides / reimburses", adjustType: "none", adjustValue: 0 },
      { id: "add_invoice", label: "We add to invoice (+cost)", adjustType: "none", adjustValue: 0 },
      { id: "prepaid", label: "Prepaid by client", adjustType: "none", adjustValue: 0 },
    ],
  },
  {
    id: "paid_parking_amount",
    label: "Paid parking amount",
    kind: "number",
    unitAdjustType: "flat",
    unitAdjustValue: 1,
    unitLabel: "$",
    note: "Flat dollar amount added when parking is paid and added to the invoice.",
  },
  {
    id: "stairs_no_lift",
    label: "Stairs / no lift",
    kind: "select",
    required: true,
    defaultOptionId: "none",
    options: [
      { id: "none", label: "None", adjustType: "none", adjustValue: 0 },
      { id: "1_2_levels", label: "1–2 levels", adjustType: "percent", adjustValue: 10 },
      { id: "3_plus_levels", label: "3+ levels", adjustType: "percent", adjustValue: 20 },
    ],
  },
  {
    id: "pets",
    label: "Pets",
    kind: "select",
    required: true,
    defaultOptionId: "none",
    options: [
      { id: "none", label: "None", adjustType: "none", adjustValue: 0 },
      { id: "pet_friendly", label: "Pet-friendly clean", adjustType: "flat", adjustValue: 25 },
    ],
  },
  {
    id: "access_difficulty",
    label: "Access difficulty",
    kind: "select",
    required: true,
    defaultOptionId: "easy",
    options: [
      { id: "easy", label: "Easy", adjustType: "none", adjustValue: 0 },
      { id: "moderate", label: "Moderate", adjustType: "percent", adjustValue: 10 },
      { id: "hard", label: "Hard", adjustType: "percent", adjustValue: 20 },
    ],
  },
];

/**
 * Lenient runtime sanitiser for the settings JSON. Returns the fallback when the
 * input is not an array; otherwise coerces each entry into a well-formed
 * PricingVariable, dropping anything unusable.
 */
export function sanitizePricingVariables(
  input: unknown,
  fallback: PricingVariable[]
): PricingVariable[] {
  if (!Array.isArray(input)) return fallback;

  const kinds: PricingVariableKind[] = ["select", "boolean", "number"];
  const adjustTypes: PricingAdjustType[] = ["flat", "percent", "none"];
  const out: PricingVariable[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!id || !label) continue;
    const kind = kinds.includes(row.kind as PricingVariableKind)
      ? (row.kind as PricingVariableKind)
      : "select";

    const variable: PricingVariable = { id, label, kind };

    if (typeof row.required === "boolean") variable.required = row.required;
    if (typeof row.allowCustom === "boolean") variable.allowCustom = row.allowCustom;
    if (typeof row.note === "string" && row.note.trim()) variable.note = row.note.trim();
    if (typeof row.defaultOptionId === "string" && row.defaultOptionId.trim()) {
      variable.defaultOptionId = row.defaultOptionId.trim();
    }

    if (Array.isArray(row.options)) {
      const options: PricingOption[] = [];
      for (const rawOpt of row.options) {
        if (!rawOpt || typeof rawOpt !== "object") continue;
        const opt = rawOpt as Record<string, unknown>;
        const optId = typeof opt.id === "string" ? opt.id.trim() : "";
        const optLabel = typeof opt.label === "string" ? opt.label.trim() : "";
        if (!optId || !optLabel) continue;
        const adjustType = adjustTypes.includes(opt.adjustType as PricingAdjustType)
          ? (opt.adjustType as PricingAdjustType)
          : "none";
        const adjustValue =
          typeof opt.adjustValue === "number" && Number.isFinite(opt.adjustValue)
            ? opt.adjustValue
            : 0;
        options.push({ id: optId, label: optLabel, adjustType, adjustValue });
      }
      if (options.length > 0) variable.options = options;
    }

    if (row.unitAdjustType === "flat" || row.unitAdjustType === "percent") {
      variable.unitAdjustType = row.unitAdjustType;
    }
    if (typeof row.unitAdjustValue === "number" && Number.isFinite(row.unitAdjustValue)) {
      variable.unitAdjustValue = row.unitAdjustValue;
    }
    if (typeof row.unitLabel === "string" && row.unitLabel.trim()) {
      variable.unitLabel = row.unitLabel.trim();
    }

    out.push(variable);
  }

  return out;
}
