import type { MarketedJobTypeValue } from "@/lib/marketing/job-types";

export type ServiceFamily = "short_stay" | "residential" | "specialty" | "exterior" | "commercial";

export type MarketedService = {
  jobType: MarketedJobTypeValue;
  slug: string;
  family: ServiceFamily;
  label: string;
  shortLabel: string;
  tagline: string;
  summary: string;
  highlights: string[];
  autoPricingMode: "estimate" | "manual";
  cardColor: string;
};

export const SERVICE_FAMILY_META: Record<ServiceFamily, { label: string; description: string }> = {
  short_stay: {
    label: "Short-Stay & Turnovers",
    description: "Guest-ready service, linen coordination, and property reset work for Airbnb and short-stay operations.",
  },
  residential: {
    label: "Residential Cleaning",
    description: "Routine and periodic home cleaning with clearer scope, recurring options, and condition-aware pricing.",
  },
  specialty: {
    label: "Specialty Interior Work",
    description: "Detailed service lines that usually depend on unit counts, access, surface type, or condition-specific review.",
  },
  exterior: {
    label: "Exterior & Grounds",
    description: "Exterior presentation, access-driven cleaning, and grounds maintenance for homes and managed properties.",
  },
  commercial: {
    label: "Commercial & Managed Sites",
    description: "Office and recurring property-care services where site conditions, access windows, and visit cadence matter.",
  },
};

export const MARKETED_SERVICES: MarketedService[] = [
  {
    jobType: "AIRBNB_TURNOVER",
    slug: "airbnb-turnover",
    family: "short_stay",
    label: "Airbnb Turnover Cleaning",
    shortLabel: "Airbnb Turnover",
    tagline: "Guest-ready resets with linen and restock awareness.",
    summary: "Designed for short-stay properties that need presentation, timing discipline, linen coordination, and photo-backed visibility.",
    highlights: ["Guest-ready reset", "Laundry and linen coordination", "Inventory and restock visibility"],
    autoPricingMode: "estimate",
    cardColor: "from-[#0f4d54]/95 to-[#1c6a73]/90",
  },
  {
    jobType: "GENERAL_CLEAN",
    slug: "general-clean",
    family: "residential",
    label: "General House Cleaning",
    shortLabel: "General Clean",
    tagline: "Routine home care without vague scope.",
    summary: "For occupied homes that want reliable general cleaning, recurring cadence, and a clearer line between normal upkeep and extra-detail work.",
    highlights: ["Recurring-ready", "Condition-aware pricing", "Suitable for occupied homes"],
    autoPricingMode: "estimate",
    cardColor: "from-[#c47f3b]/95 to-[#e2a45f]/90",
  },
  {
    jobType: "DEEP_CLEAN",
    slug: "deep-clean",
    family: "residential",
    label: "Deep Cleaning",
    shortLabel: "Deep Clean",
    tagline: "Detailed resets for neglected or high-detail properties.",
    summary: "Best when the site needs extra recovery work, more detail, or a periodic reset beyond routine cleaning scope.",
    highlights: ["Higher-detail scope", "Condition multipliers", "Manual review fallback for unusual sites"],
    autoPricingMode: "estimate",
    cardColor: "from-[#21424b]/95 to-[#2d5f69]/90",
  },
  {
    jobType: "END_OF_LEASE",
    slug: "end-of-lease",
    family: "residential",
    label: "End of Lease Cleaning",
    shortLabel: "End of Lease",
    tagline: "Scope-led vacate and inspection preparation.",
    summary: "For vacate, inspection, and handover situations where scope accuracy matters more than generic flat pricing.",
    highlights: ["Vacate-ready scope", "Inspection-oriented", "Admin review when heavy recovery is needed"],
    autoPricingMode: "estimate",
    cardColor: "from-[#4b305c]/95 to-[#7f4b93]/90",
  },
  {
    jobType: "SPRING_CLEANING",
    slug: "spring-cleaning",
    family: "residential",
    label: "Spring Cleaning",
    shortLabel: "Spring Clean",
    tagline: "Seasonal reset for homes that need more than maintenance.",
    summary: "A bigger reset than general cleaning, but still structured enough for a guided estimate and scope review.",
    highlights: ["Seasonal reset", "Room-by-room uplift", "Ideal before hosting or property refresh"],
    autoPricingMode: "estimate",
    cardColor: "from-[#29685c]/95 to-[#3c8f7f]/90",
  },
  {
    jobType: "POST_CONSTRUCTION",
    slug: "post-construction",
    family: "specialty",
    label: "Post-Construction Cleaning",
    shortLabel: "Post-Construction",
    tagline: "Dust, residue, and builder-clean follow-up.",
    summary: "For renovation, fit-out, or builder-clean follow-up where residue level and access conditions heavily affect scope.",
    highlights: ["Dust and residue removal", "Manual review when site risk is high", "Works for staged handovers"],
    autoPricingMode: "manual",
    cardColor: "from-[#6c4c36]/95 to-[#9b6d46]/90",
  },
  {
    jobType: "CARPET_STEAM_CLEAN",
    slug: "carpet-steam-cleaning",
    family: "specialty",
    label: "Carpet Steam Cleaning",
    shortLabel: "Carpet Steam",
    tagline: "Room-based treatment for carpeted spaces.",
    summary: "Steam-cleaning for bedrooms, living spaces, and targeted carpet areas with room-count pricing and condition review.",
    highlights: ["Room-count pricing", "Ideal for end-of-lease add-ons", "Manual review for major staining"],
    autoPricingMode: "estimate",
    cardColor: "from-[#1d5066]/95 to-[#2d7594]/90",
  },
  {
    jobType: "UPHOLSTERY_CLEANING",
    slug: "upholstery-cleaning",
    family: "specialty",
    label: "Upholstery Cleaning",
    shortLabel: "Upholstery",
    tagline: "Targeted seating and soft-furnishing refresh.",
    summary: "Focused upholstery cleaning for sofas, armchairs, and soft furnishings where unit counts and fabric risk matter.",
    highlights: ["Sofa and chair treatment", "Unit-based estimator", "Photo review for specialty fabrics"],
    autoPricingMode: "estimate",
    cardColor: "from-[#62503d]/95 to-[#8b6f53]/90",
  },
  {
    jobType: "TILE_GROUT_CLEANING",
    slug: "tile-and-grout-cleaning",
    family: "specialty",
    label: "Tile & Grout Cleaning",
    shortLabel: "Tile & Grout",
    tagline: "Focused restoration for high-use tiled areas.",
    summary: "For bathrooms, kitchens, and tiled zones that need specialised attention beyond a standard clean.",
    highlights: ["Area-based estimate", "Bathroom and kitchen focus", "Manual review for heavy restoration"],
    autoPricingMode: "estimate",
    cardColor: "from-[#3b5462]/95 to-[#537586]/90",
  },
  {
    jobType: "MOLD_TREATMENT",
    slug: "mould-treatment",
    family: "specialty",
    label: "Mould Treatment",
    shortLabel: "Mould Treatment",
    tagline: "Condition-sensitive treatment that should not be guessed.",
    summary: "A review-first service for mould-prone areas where severity, safety, and source conditions must be considered before confirmation.",
    highlights: ["Review-first workflow", "Safety-sensitive", "Escalates to manual confirmation"],
    autoPricingMode: "manual",
    cardColor: "from-[#2e4433]/95 to-[#4d6a53]/90",
  },
  {
    jobType: "WINDOW_CLEAN",
    slug: "window-cleaning",
    family: "exterior",
    label: "Window Cleaning",
    shortLabel: "Window Clean",
    tagline: "Window-count based pricing with access sensitivity.",
    summary: "Interior or exterior window work where pane counts, stories, and access conditions change the real job time.",
    highlights: ["Pane-count estimate", "Exterior access review", "Works as a standalone or add-on service"],
    autoPricingMode: "estimate",
    cardColor: "from-[#215d6a]/95 to-[#2b8899]/90",
  },
  {
    jobType: "PRESSURE_WASH",
    slug: "pressure-washing",
    family: "exterior",
    label: "Pressure Washing",
    shortLabel: "Pressure Wash",
    tagline: "Exterior wash-down pricing by area and surface complexity.",
    summary: "Suitable for driveways, outdoor hard surfaces, and presentation resets where area and buildup determine the right price.",
    highlights: ["Area-based estimate", "Surface-condition adjustment", "Ideal before inspections or listing photos"],
    autoPricingMode: "estimate",
    cardColor: "from-[#15384f]/95 to-[#245a7d]/90",
  },
  {
    jobType: "GUTTER_CLEANING",
    slug: "gutter-cleaning",
    family: "exterior",
    label: "Gutter Cleaning",
    shortLabel: "Gutter Clean",
    tagline: "Access-led exterior maintenance with height sensitivity.",
    summary: "For single- or multi-level properties that need safe access review and debris-level confirmation before service.",
    highlights: ["Access-sensitive", "Manual review for multi-storey risk", "Seasonal maintenance fit"],
    autoPricingMode: "manual",
    cardColor: "from-[#54473b]/95 to-[#75634d]/90",
  },
  {
    jobType: "LAWN_MOWING",
    slug: "lawn-mowing",
    family: "exterior",
    label: "Lawn Mowing",
    shortLabel: "Lawn Mowing",
    tagline: "Grounds upkeep with area, access, and overgrowth allowances.",
    summary: "A practical grounds-care path for mow-and-tidy style work, with heavier overgrowth flagged for review.",
    highlights: ["Area-based estimate", "Recurring-ready", "Overgrowth review path"],
    autoPricingMode: "estimate",
    cardColor: "from-[#27553a]/95 to-[#3a7a52]/90",
  },
  {
    jobType: "COMMERCIAL_RECURRING",
    slug: "office-commercial-cleaning",
    family: "commercial",
    label: "Office & Commercial Cleaning",
    shortLabel: "Commercial Cleaning",
    tagline: "Recurring site care for offices and managed commercial spaces.",
    summary: "Built for offices and recurring commercial spaces where site access, visit windows, and expectations are better handled through review than guesswork.",
    highlights: ["Recurring commercial scope", "Manual review and site-fit confirmation", "Suitable for ongoing agreements"],
    autoPricingMode: "manual",
    cardColor: "from-[#282f43]/95 to-[#434d73]/90",
  },
];

export function getMarketedService(jobType: MarketedJobTypeValue | string) {
  return MARKETED_SERVICES.find((service) => service.jobType === jobType) ?? null;
}

export function getMarketedServiceBySlug(slug: string) {
  return MARKETED_SERVICES.find((service) => service.slug === slug) ?? null;
}

export function getServicesByFamily(family: ServiceFamily) {
  return MARKETED_SERVICES.filter((service) => service.family === family);
}
