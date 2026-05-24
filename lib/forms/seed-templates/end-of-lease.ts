import type { FormKind, JobType } from "@prisma/client";
import type { FormSchema } from "../types";

// Bond-clean checklist based on RACV / Tenants Union NSW standards.
// 80+ items across general, bedrooms, bathrooms, kitchen, laundry, floors,
// windows, garage, and a final landlord-match inspection.
export const endOfLeaseTemplate: {
  name: string;
  kind: FormKind;
  serviceType: JobType;
  version: number;
  schema: FormSchema;
} = {
  name: "End of Lease — Bond Clean v1",
  kind: "END_OF_LEASE",
  serviceType: "END_OF_LEASE",
  version: 1,
  schema: {
    sections: [
      {
        id: "general",
        title: "General (every room)",
        fields: [
          { id: "gen-cobwebs", type: "checkbox", label: "Cobwebs removed (ceilings + corners)", required: true, scoring: { weight: 2, max: 1 } },
          { id: "gen-light-fittings", type: "checkbox", label: "Light fittings + covers cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "gen-light-switches", type: "checkbox", label: "Light switches wiped", required: true },
          { id: "gen-power-points", type: "checkbox", label: "Power points wiped", required: true },
          { id: "gen-skirting", type: "checkbox", label: "Skirting boards dusted + wiped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "gen-walls-marks", type: "checkbox", label: "Walls — scuffs / marks spot-cleaned", required: true, scoring: { weight: 3, max: 1 } },
          { id: "gen-doors", type: "checkbox", label: "Doors + frames + handles wiped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "gen-door-tracks", type: "checkbox", label: "Door tracks vacuumed + wiped" },
          { id: "gen-aircon-vents", type: "checkbox", label: "Air-con vents + filters cleaned", scoring: { weight: 2, max: 1 } },
          { id: "gen-ceiling-fans", type: "checkbox", label: "Ceiling fans dusted (blades + housing)", scoring: { weight: 2, max: 1 } },
          { id: "gen-smoke-alarms", type: "checkbox", label: "Smoke alarm covers wiped" },
        ],
      },
      {
        id: "bedrooms",
        title: "Bedrooms",
        fields: [
          { id: "bed-wardrobe-interior", type: "checkbox", label: "Wardrobe interior wiped + vacuumed", required: true, scoring: { weight: 2, max: 1 } },
          { id: "bed-wardrobe-tracks", type: "checkbox", label: "Wardrobe sliding tracks vacuumed", required: true },
          { id: "bed-wardrobe-mirrors", type: "checkbox", label: "Wardrobe mirrors / glass cleaned", required: true },
          { id: "bed-shelves", type: "checkbox", label: "Built-in shelves wiped" },
          { id: "bed-window-tracks", type: "checkbox", label: "Bedroom window tracks vacuumed + wiped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "bed-blinds", type: "checkbox", label: "Blinds dusted (slats + cords)", required: true, scoring: { weight: 2, max: 1 } },
          { id: "bed-curtains", type: "checkbox", label: "Curtains shaken out / steamed" },
          { id: "bed-fans", type: "checkbox", label: "Bedroom fans dusted" },
          { id: "bed-photos", type: "photo", label: "Photo each bedroom (post-clean)", required: true, minPhotos: 1 },
        ],
      },
      {
        id: "bathrooms",
        title: "Bathrooms",
        fields: [
          { id: "bath-tiles-grout", type: "checkbox", label: "Wall tiles + grout scrubbed", required: true, scoring: { weight: 3, max: 1 } },
          { id: "bath-floor-tiles", type: "checkbox", label: "Floor tiles + grout cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "bath-mirror", type: "checkbox", label: "Mirror polished streak-free", required: true },
          { id: "bath-mould", type: "checkbox", label: "Mould check (sealant + corners) — treated", required: true, scoring: { weight: 3, max: 1 } },
          { id: "bath-mould-photos", type: "photo", label: "Photo any pre-existing mould", minPhotos: 0 },
          { id: "bath-shower-screen", type: "checkbox", label: "Shower screen — soap scum removed", required: true, scoring: { weight: 2, max: 1 } },
          { id: "bath-shower-head", type: "checkbox", label: "Shower head descaled" },
          { id: "bath-exhaust-fan", type: "checkbox", label: "Exhaust fan dusted + cover wiped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "bath-toilet-top", type: "checkbox", label: "Toilet — seat top sanitized", required: true, scoring: { weight: 2, max: 1 } },
          { id: "bath-toilet-bottom", type: "checkbox", label: "Toilet — seat underside + base sanitized", required: true, scoring: { weight: 3, max: 1 } },
          { id: "bath-toilet-bowl", type: "checkbox", label: "Toilet bowl scrubbed", required: true, scoring: { weight: 2, max: 1 } },
          { id: "bath-vanity", type: "checkbox", label: "Vanity + drawers cleaned (interior + exterior)", required: true },
          { id: "bath-taps", type: "checkbox", label: "Taps polished + descaled", required: true },
          { id: "bath-towel-rails", type: "checkbox", label: "Towel rails + hooks wiped" },
          { id: "bath-photos", type: "photo", label: "Photo each bathroom", required: true, minPhotos: 1 },
        ],
      },
      {
        id: "kitchen",
        title: "Kitchen",
        fields: [
          { id: "kit-oven-interior", type: "checkbox", label: "Oven interior degreased (walls + base + roof)", required: true, scoring: { weight: 4, max: 1 } },
          { id: "kit-oven-door-glass", type: "checkbox", label: "Oven door — both glass panes cleaned", required: true, scoring: { weight: 3, max: 1 } },
          { id: "kit-oven-racks", type: "checkbox", label: "Oven racks + trays soaked + scrubbed", required: true, scoring: { weight: 2, max: 1 } },
          { id: "kit-rangehood", type: "checkbox", label: "Rangehood degreased", required: true, scoring: { weight: 3, max: 1 } },
          { id: "kit-rangehood-filter", type: "checkbox", label: "Rangehood filter cleaned / replaced", required: true, scoring: { weight: 2, max: 1 } },
          { id: "kit-stovetop", type: "checkbox", label: "Stovetop + knobs cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "kit-splashback", type: "checkbox", label: "Splashback cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "kit-cabinets-ext", type: "checkbox", label: "Cabinets — exterior wiped (handles + faces)", required: true, scoring: { weight: 2, max: 1 } },
          { id: "kit-cabinets-int", type: "checkbox", label: "Cabinets — interior wiped (all shelves + drawers)", required: true, scoring: { weight: 3, max: 1 } },
          { id: "kit-bench", type: "checkbox", label: "Benchtops cleaned + polished", required: true, scoring: { weight: 2, max: 1 } },
          { id: "kit-sink", type: "checkbox", label: "Sink + taps polished + descaled", required: true, scoring: { weight: 2, max: 1 } },
          { id: "kit-dishwasher", type: "checkbox", label: "Dishwasher — filter + seal + interior cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "kit-microwave", type: "checkbox", label: "Microwave interior + exterior cleaned" },
          { id: "kit-fridge-interior", type: "checkbox", label: "Fridge — interior wiped (if vacated)", scoring: { weight: 2, max: 1 } },
          { id: "kit-fridge-seals", type: "checkbox", label: "Fridge seals cleaned" },
          { id: "kit-pantry", type: "checkbox", label: "Pantry — shelves wiped" },
          { id: "kit-photos", type: "photo", label: "Photo kitchen (oven open + closed + benchtops)", required: true, minPhotos: 3, scoring: { weight: 2, max: 1 } },
        ],
      },
      {
        id: "laundry-room",
        title: "Laundry",
        fields: [
          { id: "lau-tub", type: "checkbox", label: "Laundry tub + taps cleaned", required: true },
          { id: "lau-bench", type: "checkbox", label: "Laundry benchtop wiped" },
          { id: "lau-cabinets", type: "checkbox", label: "Cabinets — interior + exterior wiped", required: true },
          { id: "lau-machine-filter", type: "checkbox", label: "Washing machine filter cleaned (if included)" },
          { id: "lau-dryer-filter", type: "checkbox", label: "Dryer lint filter cleaned (if included)" },
          { id: "lau-floor", type: "checkbox", label: "Laundry floor mopped", required: true },
        ],
      },
      {
        id: "floors",
        title: "Floors",
        fields: [
          { id: "flo-vacuum-carpets", type: "checkbox", label: "All carpeted areas vacuumed (edges + corners)", required: true, scoring: { weight: 2, max: 1 } },
          { id: "flo-mop-hard", type: "checkbox", label: "Hard floors mopped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "flo-carpet-steam", type: "checkbox", label: "Carpet steam clean booked / completed", helpText: "Often a separate task — confirm receipt." },
          { id: "flo-carpet-receipt", type: "photo", label: "Photo of steam-clean receipt", minPhotos: 0, conditional: { fieldId: "flo-carpet-steam", equals: true } },
          { id: "flo-stain-log", type: "longtext", label: "Pre-existing carpet stains noted" },
        ],
      },
      {
        id: "windows",
        title: "Windows",
        fields: [
          { id: "win-interior-all", type: "checkbox", label: "All interior windows cleaned (glass + frames + sills)", required: true, scoring: { weight: 2, max: 1 } },
          { id: "win-exterior", type: "checkbox", label: "Exterior windows cleaned (accessible)", required: true, scoring: { weight: 2, max: 1 } },
          { id: "win-flyscreens", type: "checkbox", label: "Flyscreens vacuumed / rinsed" },
          { id: "win-tracks", type: "checkbox", label: "Window tracks vacuumed + wiped", required: true, scoring: { weight: 2, max: 1 } },
        ],
      },
      {
        id: "outdoor",
        title: "Garage / outdoor",
        fields: [
          { id: "out-garage-sweep", type: "checkbox", label: "Garage swept" },
          { id: "out-garage-cobwebs", type: "checkbox", label: "Garage cobwebs removed" },
          { id: "out-balcony", type: "checkbox", label: "Balcony / courtyard swept" },
          { id: "out-bins-clean", type: "checkbox", label: "External bins rinsed (if requested)" },
        ],
      },
      {
        id: "final",
        title: "Final inspection",
        description: "Match against the landlord's entry condition report.",
        fields: [
          { id: "fin-landlord-checklist", type: "checkbox", label: "Landlord checklist items addressed", required: true, scoring: { weight: 3, max: 1 } },
          { id: "fin-condition-report", type: "photo", label: "Photo every room (post-clean)", required: true, minPhotos: 5, scoring: { weight: 3, max: 1 } },
          { id: "fin-rubbish-removed", type: "checkbox", label: "All rubbish removed from property", required: true, scoring: { weight: 2, max: 1 } },
          { id: "fin-keys", type: "select", label: "Keys handed off to", options: ["Agent", "Landlord", "Returned to lockbox"], required: true },
          { id: "fin-cleaner-signature", type: "signature", label: "Cleaner signature", required: true },
          { id: "fin-notes", type: "longtext", label: "Notes / issues to flag" },
        ],
      },
    ],
  },
};
