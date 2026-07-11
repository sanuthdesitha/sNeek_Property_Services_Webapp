import { JobType } from "@prisma/client";

/**
 * Per-job-type pricing. Each service has its OWN pricing model and the only the
 * fields that make sense for it (a window clean is priced per window, a pressure
 * wash per sqm, a carpet steam per room — NOT by bedrooms). Rates are editable
 * admin defaults set to current Sydney market levels, ex-GST, calibrated to keep
 * a healthy margin over ~$32/hr labour.
 */
export type PricingModel = "ROOMS" | "AREA" | "WINDOWS" | "ITEMS" | "BANDS" | "HOURLY";

export interface ServiceBand {
  label: string;
  price: number;
}

export interface ServiceRate {
  base?: number;
  perBedroom?: number;
  perBathroom?: number;
  perSqm?: number;
  perWindow?: number;
  perItem?: number;
  hourly?: number;
  bands?: ServiceBand[];
  minCharge: number;
}

export interface ServiceConfig {
  jobType: JobType;
  label: string;
  model: PricingModel;
  /** Item noun for ITEMS model, e.g. "room", "seat". */
  itemLabel?: string;
  /** Hint shown in the admin/builder for AREA/HOURLY inputs. */
  unitLabel?: string;
  /** Whether the calculator can auto-price it (false = manual line items). */
  autoPriceable: boolean;
  rate: ServiceRate;
}

/**
 * The catalog + default market rates. Admins can override `rate` per type at
 * /admin/pricing; overrides live in settings.servicePricing.
 */
export const SERVICE_CATALOG: ServiceConfig[] = [
  // ---- Room-based (bedrooms + bathrooms) ----
  { jobType: JobType.AIRBNB_TURNOVER, label: "Airbnb turnover", model: "ROOMS", autoPriceable: true,
    rate: { base: 60, perBedroom: 18, perBathroom: 25, perSqm: 0.2, minCharge: 110 } },
  { jobType: JobType.GENERAL_CLEAN, label: "Regular / general clean", model: "ROOMS", autoPriceable: true,
    rate: { base: 70, perBedroom: 20, perBathroom: 28, perSqm: 0.3, minCharge: 120 } },
  { jobType: JobType.SPRING_CLEANING, label: "Spring clean", model: "ROOMS", autoPriceable: true,
    rate: { base: 110, perBedroom: 35, perBathroom: 45, perSqm: 0.4, minCharge: 220 } },
  { jobType: JobType.DEEP_CLEAN, label: "Deep clean", model: "ROOMS", autoPriceable: true,
    rate: { base: 140, perBedroom: 40, perBathroom: 55, perSqm: 0.5, minCharge: 245 } },
  { jobType: JobType.END_OF_LEASE, label: "End of lease / bond", model: "ROOMS", autoPriceable: true,
    rate: { base: 200, perBedroom: 50, perBathroom: 80, perSqm: 0.6, minCharge: 320 } },
  { jobType: JobType.MOVE_IN_CLEAN, label: "Move-in clean", model: "ROOMS", autoPriceable: true,
    rate: { base: 170, perBedroom: 45, perBathroom: 65, perSqm: 0.55, minCharge: 285 } },

  // ---- Area-based (sqm) ----
  { jobType: JobType.PRESSURE_WASH, label: "Pressure washing", model: "AREA", unitLabel: "sqm", autoPriceable: true,
    rate: { base: 0, perSqm: 6, minCharge: 180 } },
  { jobType: JobType.TILE_GROUT_CLEANING, label: "Tile & grout cleaning", model: "AREA", unitLabel: "sqm", autoPriceable: true,
    rate: { base: 0, perSqm: 12, minCharge: 150 } },
  { jobType: JobType.POST_CONSTRUCTION, label: "Post-construction clean", model: "AREA", unitLabel: "sqm", autoPriceable: true,
    rate: { base: 120, perSqm: 8, minCharge: 400 } },

  // ---- Per-window ----
  { jobType: JobType.WINDOW_CLEAN, label: "Window cleaning", model: "WINDOWS", autoPriceable: true,
    rate: { base: 0, perWindow: 10, minCharge: 90 } },

  // ---- Per-item ----
  { jobType: JobType.CARPET_STEAM_CLEAN, label: "Carpet steam cleaning", model: "ITEMS", itemLabel: "room", autoPriceable: true,
    rate: { base: 0, perItem: 35, minCharge: 99 } },
  { jobType: JobType.UPHOLSTERY_CLEANING, label: "Upholstery cleaning", model: "ITEMS", itemLabel: "seat", autoPriceable: true,
    rate: { base: 0, perItem: 50, minCharge: 90 } },

  // ---- Size bands ----
  { jobType: JobType.LAWN_MOWING, label: "Lawn mowing", model: "BANDS", autoPriceable: true,
    rate: { minCharge: 60, bands: [
      { label: "Small (under 200 sqm)", price: 60 },
      { label: "Medium (200–600 sqm)", price: 95 },
      { label: "Large (600–1000 sqm)", price: 140 },
      { label: "Extra large (1000 sqm+)", price: 200 },
    ] } },
  { jobType: JobType.GUTTER_CLEANING, label: "Gutter cleaning", model: "BANDS", autoPriceable: true,
    rate: { minCharge: 180, bands: [
      { label: "Single storey – small", price: 180 },
      { label: "Single storey – large", price: 250 },
      { label: "Double storey", price: 350 },
    ] } },

  // ---- Hourly / manual ----
  { jobType: JobType.COMMERCIAL_RECURRING, label: "Commercial (recurring)", model: "HOURLY", unitLabel: "hours", autoPriceable: true,
    rate: { base: 0, hourly: 50, minCharge: 100 } },
  { jobType: JobType.SPECIAL_CLEAN, label: "Special clean", model: "HOURLY", unitLabel: "hours", autoPriceable: true,
    rate: { base: 0, hourly: 55, minCharge: 120 } },
  { jobType: JobType.MOLD_TREATMENT, label: "Mould treatment", model: "HOURLY", unitLabel: "hours", autoPriceable: true,
    rate: { base: 0, hourly: 75, minCharge: 250 } },
];

export const SERVICE_CONFIG_BY_TYPE: Record<string, ServiceConfig> = Object.fromEntries(
  SERVICE_CATALOG.map((c) => [c.jobType, c])
);

export type ServicePricingMap = Record<string, ServiceRate>;

/** Default rate map (jobType → rate) used as the seed/fallback for settings. */
export function defaultServicePricing(): ServicePricingMap {
  return Object.fromEntries(SERVICE_CATALOG.map((c) => [c.jobType, c.rate]));
}

export interface PriceServiceInputs {
  bedrooms?: number;
  bathrooms?: number;
  sqm?: number;
  windows?: number;
  items?: number;
  hours?: number;
  bandIndex?: number;
}

export interface PricedLine {
  label: string;
  unitPrice: number;
  qty: number;
  total: number;
}

function round2(n: number) {
  return Number(n.toFixed(2));
}

/**
 * Price a single service from its model + rate. Returns line items (summing to a
 * value at least the minimum charge) — pre-GST. The caller applies GST/discounts.
 */
export function priceService(
  jobType: string,
  inputs: PriceServiceInputs,
  rateOverride?: ServiceRate
): { lineItems: PricedLine[]; subtotal: number } {
  const config = SERVICE_CONFIG_BY_TYPE[jobType];
  if (!config) return { lineItems: [], subtotal: 0 };
  const rate = { ...config.rate, ...(rateOverride ?? {}) };
  const min = rate.minCharge ?? 0;
  const lines: PricedLine[] = [];

  const pushLine = (label: string, unitPrice: number, qty: number) => {
    const total = round2(unitPrice * qty);
    if (total !== 0 || qty !== 0) lines.push({ label, unitPrice: round2(unitPrice), qty, total });
  };

  if (config.model === "ROOMS") {
    if (rate.base) pushLine(`${config.label} base`, rate.base, 1);
    const beds = Math.max(0, inputs.bedrooms ?? 0);
    const baths = Math.max(0, inputs.bathrooms ?? 0);
    const sqm = Math.max(0, inputs.sqm ?? 0);
    if (beds > 0 && rate.perBedroom) pushLine(`Bedrooms (${beds})`, rate.perBedroom, beds);
    if (baths > 0 && rate.perBathroom) pushLine(`Bathrooms (${baths})`, rate.perBathroom, baths);
    // Floor area adds to the base so larger homes price higher.
    if (sqm > 0 && rate.perSqm) pushLine(`Floor area (${sqm} sqm)`, rate.perSqm, sqm);
  } else if (config.model === "AREA") {
    if (rate.base) pushLine(`${config.label} base`, rate.base, 1);
    const sqm = Math.max(0, inputs.sqm ?? 0);
    if (sqm > 0 && rate.perSqm) pushLine(`${config.label} (${sqm} ${config.unitLabel ?? "sqm"})`, rate.perSqm, sqm);
  } else if (config.model === "WINDOWS") {
    const windows = Math.max(0, inputs.windows ?? 0);
    if (rate.base) pushLine(`${config.label} base`, rate.base, 1);
    if (windows > 0 && rate.perWindow) pushLine(`Windows (${windows})`, rate.perWindow, windows);
  } else if (config.model === "ITEMS") {
    const items = Math.max(0, inputs.items ?? 0);
    const noun = config.itemLabel ?? "item";
    if (rate.base) pushLine(`${config.label} base`, rate.base, 1);
    if (items > 0 && rate.perItem) pushLine(`${noun.charAt(0).toUpperCase() + noun.slice(1)}s (${items})`, rate.perItem, items);
  } else if (config.model === "BANDS") {
    const band = (rate.bands ?? [])[inputs.bandIndex ?? 0];
    if (band) pushLine(`${config.label} — ${band.label}`, band.price, 1);
  } else if (config.model === "HOURLY") {
    if (rate.base) pushLine(`${config.label} base`, rate.base, 1);
    const hours = Math.max(0, inputs.hours ?? 0);
    if (hours > 0 && rate.hourly) pushLine(`Labour (${hours} hrs @ $${rate.hourly}/hr)`, rate.hourly, hours);
  }

  let subtotal = round2(lines.reduce((acc, l) => acc + l.total, 0));

  // Enforce minimum charge.
  if (subtotal < min) {
    if (lines.length === 0) {
      lines.push({ label: `${config.label} (minimum)`, unitPrice: min, qty: 1, total: min });
    } else {
      lines.push({ label: "Minimum charge adjustment", unitPrice: round2(min - subtotal), qty: 1, total: round2(min - subtotal) });
    }
    subtotal = min;
  }

  return { lineItems: lines, subtotal };
}
