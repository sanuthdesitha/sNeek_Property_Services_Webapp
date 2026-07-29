// Starter blueprints for the form builder.
//
// These are the "start from a template instead of a blank canvas" options in
// the new-form flow. They differ from `lib/forms/seed-templates` (which the DB
// seeder upserts by kind+version to create REAL rows): a starter is a UI-facing
// blueprint — it carries the copy the picker needs (description, tags) and is
// only ever COPIED into a brand-new draft template. Nothing here is written to
// the database as-is, so ids/versioning are not a concern.
//
// Authoring rules (enforced by tests/lib/starter-templates.test.ts):
//  - field ids are unique inside a template (the renderer keys answers by id)
//  - `serviceType` is a real JobType, `kind` a real FormKind
//  - every conditional points at a field that exists in the SAME template
//  - schemas survive `normalizeFormSchema` with all sections/fields intact
//
// House style for a Sydney cleaning crew: checkbox tasks carry QA scoring
// weights, every room ends with photo proof (`minPhotos`), and anything the
// office has to act on (damage, access problems, shortages) is captured as a
// conditional follow-up rather than a free-text afterthought.

import type { FormKind, JobType } from "@prisma/client";
import type { FormSchema } from "./types";

export interface StarterTemplate {
  /** Stable slug used by the picker + create payload. */
  id: string;
  name: string;
  /** One line the owner reads in the gallery card. */
  description: string;
  serviceType: JobType;
  kind: FormKind;
  tags: string[];
  schema: FormSchema;
}

const airbnbTurnover: StarterTemplate = {
  id: "airbnb-turnover",
  name: "Airbnb turnover",
  description:
    "Same-day short-stay reset: guest damage triage, linen, restock and the photo set the host expects before the next check-in.",
  serviceType: "AIRBNB_TURNOVER",
  kind: "AIRBNB_TURNOVER",
  tags: ["Short stay", "Photo proof", "Restock"],
  schema: {
    sections: [
      {
        id: "arrival",
        title: "Arrival & guest damage",
        description: "Two minutes before you touch anything — this is what protects the host's claim.",
        fields: [
          { id: "arrival-access", type: "select", label: "How did you get in?", options: ["Lockbox", "Smart lock", "Key from host", "Building concierge", "Could not access"], required: true },
          { id: "arrival-access-issue", type: "longtext", label: "Describe the access problem", required: true, conditional: { fieldId: "arrival-access", operator: "equals", value: "Could not access" } },
          { id: "arrival-damage-found", type: "yesno", label: "Any guest damage or missing items?", required: true, detailsWhenNo: false },
          { id: "arrival-damage-notes", type: "longtext", label: "What is damaged / missing?", required: true, conditional: { fieldId: "arrival-damage-found", operator: "equals", value: true } },
          { id: "arrival-damage-photos", type: "photo", label: "Damage photos", minPhotos: 2, required: true, stampTag: "damage", severity: "high", conditional: { fieldId: "arrival-damage-found", operator: "equals", value: true } },
          { id: "arrival-left-behind", type: "longtext", label: "Items left behind by guests", helpText: "Lost & found: bag it and note where you left it." },
        ],
      },
      {
        id: "bedrooms",
        title: "Bedrooms",
        fields: [
          { id: "bed-stripped", type: "checkbox", label: "All beds stripped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "bed-linen-fresh", type: "checkbox", label: "Fresh linen on every bed, hotel finish", required: true, scoring: { weight: 3, max: 1 } },
          { id: "bed-surfaces", type: "checkbox", label: "Bedsides, dressers and mirrors wiped", required: true, scoring: { weight: 1, max: 1 } },
          { id: "bed-floors", type: "checkbox", label: "Floors vacuumed / mopped, under the bed included", required: true, scoring: { weight: 2, max: 1 } },
          { id: "bed-photos", type: "photo", label: "Photo of each finished bedroom", required: true, minPhotos: 1, stampTag: "after", evidenceCategory: "BEDROOM" },
        ],
      },
      {
        id: "bathrooms",
        title: "Bathrooms",
        fields: [
          { id: "bath-toilet", type: "checkbox", label: "Toilet sanitised — seat top, underside, base", required: true, scoring: { weight: 3, max: 1 } },
          { id: "bath-shower", type: "checkbox", label: "Shower, screen and grout cleaned", required: true, scoring: { weight: 3, max: 1 } },
          { id: "bath-mirror", type: "checkbox", label: "Mirror and basin streak-free", required: true, scoring: { weight: 2, max: 1 } },
          { id: "bath-towels", type: "checkbox", label: "Fresh towels set out, toiletries restocked", required: true, scoring: { weight: 2, max: 1 } },
          { id: "bath-photos", type: "photo", label: "Photo of each finished bathroom", required: true, minPhotos: 1, stampTag: "after", evidenceCategory: "BATHROOM" },
        ],
      },
      {
        id: "kitchen-living",
        title: "Kitchen & living",
        fields: [
          { id: "kit-dishes", type: "checkbox", label: "Dishes washed and put away, dishwasher empty", required: true, scoring: { weight: 2, max: 1 } },
          { id: "kit-benches", type: "checkbox", label: "Benchtops, splashback and stovetop cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "kit-fridge", type: "checkbox", label: "Fridge cleared of guest leftovers", required: true, scoring: { weight: 2, max: 1 } },
          { id: "kit-bins", type: "checkbox", label: "All bins emptied and relined", required: true, scoring: { weight: 2, max: 1 } },
          { id: "kit-living", type: "checkbox", label: "Living areas dusted, cushions styled, floors done", required: true, scoring: { weight: 2, max: 1 } },
          { id: "kit-photos", type: "photo", label: "Photo of finished kitchen and living area", required: true, minPhotos: 2, stampTag: "after", evidenceCategory: "KITCHEN" },
        ],
      },
      {
        id: "restock",
        title: "Restock & consumables",
        fields: [
          { id: "restock-items", type: "multiselect", label: "Consumables replaced", options: ["Toilet paper", "Hand soap", "Body wash", "Shampoo", "Conditioner", "Dish soap", "Sponge", "Paper towel", "Bin liners", "Coffee", "Tea", "Dishwasher tablets"] },
          { id: "restock-short", type: "yesno", label: "Anything running low the office must reorder?", required: true },
          { id: "restock-short-notes", type: "longtext", label: "What needs reordering?", required: true, conditional: { fieldId: "restock-short", operator: "equals", value: true } },
        ],
      },
      {
        id: "handover",
        title: "Lock-up & handover",
        fields: [
          { id: "hand-walkthrough", type: "checkbox", label: "Final walkthrough done — guest-ready", required: true, scoring: { weight: 2, max: 1 } },
          { id: "hand-secure", type: "checkbox", label: "Windows and doors locked, lights off, A/C set", required: true, scoring: { weight: 3, max: 1 } },
          { id: "hand-keys", type: "select", label: "Keys returned to", options: ["Lockbox", "Host", "Concierge", "Left on bench"], required: true },
          { id: "hand-hero-photo", type: "photo", label: "Hero shot of the finished space", required: true, minPhotos: 1, stampTag: "after", evidenceCategory: "FINAL" },
          { id: "hand-signature", type: "signature", label: "Cleaner sign-off", required: true },
        ],
      },
    ],
    theme: { accentColor: "#1f7a5a", showDividers: true },
  },
};

const endOfLease: StarterTemplate = {
  id: "end-of-lease-bond",
  name: "End of lease / bond clean",
  description:
    "Agent-inspection grade vacate clean — oven, walls, blinds and wet areas with before/after evidence for the bond claim.",
  serviceType: "END_OF_LEASE",
  kind: "END_OF_LEASE",
  tags: ["Bond back", "Inspection", "Before/after"],
  schema: {
    sections: [
      {
        id: "eol-scope",
        title: "Scope confirmation",
        fields: [
          { id: "eol-property-empty", type: "yesno", label: "Property fully vacated (no tenant belongings)?", required: true },
          { id: "eol-leftovers", type: "longtext", label: "What has been left behind?", required: true, conditional: { fieldId: "eol-property-empty", operator: "equals", value: false } },
          { id: "eol-extras", type: "multiselect", label: "Extras included in this job", options: ["Carpet steam clean", "Blind cleaning", "Wall washing", "Garage", "Balcony", "Pest control"] },
          { id: "eol-before-photos", type: "photo", label: "Before photos — every room", required: true, minPhotos: 4, stampTag: "before" },
        ],
      },
      {
        id: "eol-kitchen",
        title: "Kitchen",
        fields: [
          { id: "eol-oven", type: "checkbox", label: "Oven degreased — racks, trays, door glass", required: true, scoring: { weight: 4, max: 1 } },
          { id: "eol-rangehood", type: "checkbox", label: "Rangehood filters degreased", required: true, scoring: { weight: 3, max: 1 } },
          { id: "eol-cupboards", type: "checkbox", label: "Cupboards and drawers emptied and wiped inside/out", required: true, scoring: { weight: 3, max: 1 } },
          { id: "eol-fridge-cavity", type: "checkbox", label: "Fridge cavity and behind appliances cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "eol-kitchen-photos", type: "photo", label: "After photos — oven interior + kitchen", required: true, minPhotos: 2, stampTag: "after", evidenceCategory: "KITCHEN" },
        ],
      },
      {
        id: "eol-wet-areas",
        title: "Bathrooms & laundry",
        fields: [
          { id: "eol-shower-grout", type: "checkbox", label: "Shower grout and silicone descaled", required: true, scoring: { weight: 4, max: 1 } },
          { id: "eol-mould", type: "yesno", label: "Mould present in any wet area?", required: true, severity: "high" },
          { id: "eol-mould-photos", type: "photo", label: "Mould photos for the report", required: true, minPhotos: 1, stampTag: "damage", conditional: { fieldId: "eol-mould", operator: "equals", value: true } },
          { id: "eol-exhaust", type: "checkbox", label: "Exhaust fans and vents dusted", required: true, scoring: { weight: 2, max: 1 } },
          { id: "eol-laundry-tub", type: "checkbox", label: "Laundry tub, taps and lint filter cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "eol-wet-photos", type: "photo", label: "After photos — each wet area", required: true, minPhotos: 2, stampTag: "after", evidenceCategory: "BATHROOM" },
        ],
      },
      {
        id: "eol-general",
        title: "Walls, windows & floors",
        fields: [
          { id: "eol-walls", type: "checkbox", label: "Wall marks spot-cleaned, skirting wiped", required: true, scoring: { weight: 3, max: 1 } },
          { id: "eol-windows", type: "checkbox", label: "Windows, tracks and flyscreens cleaned", required: true, scoring: { weight: 3, max: 1 } },
          { id: "eol-blinds", type: "checkbox", label: "Blinds / curtains dusted", scoring: { weight: 2, max: 1 } },
          { id: "eol-lights", type: "checkbox", label: "Light fittings and switches wiped, cobwebs removed", required: true, scoring: { weight: 2, max: 1 } },
          { id: "eol-floors", type: "checkbox", label: "All floors vacuumed and mopped, edges included", required: true, scoring: { weight: 3, max: 1 } },
          { id: "eol-carpet-steam", type: "yesno", label: "Carpet steam clean completed?", conditional: { fieldId: "eol-extras", operator: "contains", value: "Carpet steam clean" } },
          { id: "eol-carpet-receipt", type: "photo", label: "Steam clean receipt / machine photo", minPhotos: 1, conditional: { fieldId: "eol-carpet-steam", operator: "equals", value: true } },
        ],
      },
      {
        id: "eol-signoff",
        title: "Damage report & sign-off",
        fields: [
          { id: "eol-damage", type: "yesno", label: "Pre-existing damage found (not caused by us)?", required: true },
          { id: "eol-damage-detail", type: "longtext", label: "Describe the damage and where it is", required: true, conditional: { fieldId: "eol-damage", operator: "equals", value: true } },
          { id: "eol-damage-photos", type: "photo", label: "Damage photos", required: true, minPhotos: 1, stampTag: "damage", conditional: { fieldId: "eol-damage", operator: "equals", value: true } },
          { id: "eol-hours", type: "number", label: "Hours on site", min: 0, max: 24, step: 0.5, unit: "h", required: true },
          { id: "eol-final-photos", type: "photo", label: "Final walkthrough photos", required: true, minPhotos: 4, stampTag: "after", evidenceCategory: "FINAL" },
          { id: "eol-signature", type: "signature", label: "Cleaner sign-off", required: true },
        ],
      },
    ],
    theme: { accentColor: "#8a6a1f", showDividers: true },
  },
};

const recurringHome: StarterTemplate = {
  id: "recurring-home-clean",
  name: "Regular home clean",
  description:
    "Weekly / fortnightly maintenance visit — short, repeatable, with a client-notes prompt and a light photo set.",
  serviceType: "GENERAL_CLEAN",
  kind: "REGULAR_MAINTENANCE",
  tags: ["Recurring", "Residential", "Quick"],
  schema: {
    sections: [
      {
        id: "reg-start",
        title: "Start of visit",
        fields: [
          { id: "reg-client-home", type: "yesno", label: "Was the client home?", required: true },
          { id: "reg-client-requests", type: "longtext", label: "Anything the client asked for today?", conditional: { fieldId: "reg-client-home", operator: "equals", value: true } },
          { id: "reg-pets", type: "checkbox", label: "Pets secured before starting" },
        ],
      },
      {
        id: "reg-kitchen",
        title: "Kitchen",
        fields: [
          { id: "reg-benches", type: "checkbox", label: "Benchtops and splashback wiped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "reg-sink", type: "checkbox", label: "Sink scrubbed, taps polished", required: true, scoring: { weight: 2, max: 1 } },
          { id: "reg-appliance-fronts", type: "checkbox", label: "Appliance fronts and microwave wiped", required: true },
          { id: "reg-kit-floor", type: "checkbox", label: "Floor swept and mopped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "reg-kit-photo", type: "photo", label: "Finished kitchen photo", required: true, minPhotos: 1, stampTag: "after", evidenceCategory: "KITCHEN" },
        ],
      },
      {
        id: "reg-bathrooms",
        title: "Bathrooms",
        fields: [
          { id: "reg-toilet", type: "checkbox", label: "Toilets sanitised", required: true, scoring: { weight: 3, max: 1 } },
          { id: "reg-showers", type: "checkbox", label: "Showers and basins cleaned", required: true, scoring: { weight: 3, max: 1 } },
          { id: "reg-mirrors", type: "checkbox", label: "Mirrors polished", required: true },
          { id: "reg-bath-photo", type: "photo", label: "Finished bathroom photo", required: true, minPhotos: 1, stampTag: "after", evidenceCategory: "BATHROOM" },
        ],
      },
      {
        id: "reg-living",
        title: "Living & bedrooms",
        fields: [
          { id: "reg-dusting", type: "checkbox", label: "Surfaces dusted, including sills and skirtings", required: true, scoring: { weight: 2, max: 1 } },
          { id: "reg-beds", type: "checkbox", label: "Beds made / linen changed if left out", required: true },
          { id: "reg-floors", type: "checkbox", label: "All floors vacuumed and mopped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "reg-bins", type: "checkbox", label: "Bins emptied and relined", required: true },
        ],
      },
      {
        id: "reg-close",
        title: "Close out",
        fields: [
          { id: "reg-supplies-low", type: "yesno", label: "Client supplies running low?", required: true },
          { id: "reg-supplies-notes", type: "longtext", label: "What should the client top up?", required: true, conditional: { fieldId: "reg-supplies-low", operator: "equals", value: true } },
          { id: "reg-next-visit-notes", type: "longtext", label: "Notes for the next visit" },
          { id: "reg-signature", type: "signature", label: "Cleaner sign-off", required: true },
        ],
      },
    ],
    theme: { accentColor: "#2f6f8f" },
  },
};

const deepClean: StarterTemplate = {
  id: "deep-clean",
  name: "Deep clean",
  description:
    "Top-to-bottom detail: behind and under appliances, inside cupboards, grout and skirtings — with before/after proof per zone.",
  serviceType: "DEEP_CLEAN",
  kind: "DEEP_CLEAN",
  tags: ["Detail", "Before/after", "Half day+"],
  schema: {
    sections: [
      {
        id: "deep-plan",
        title: "Plan & before shots",
        fields: [
          { id: "deep-focus", type: "multiselect", label: "Client's priority zones", options: ["Kitchen", "Bathrooms", "Bedrooms", "Living", "Laundry", "Balcony", "Garage"], required: true },
          { id: "deep-before", type: "photo", label: "Before photos of every priority zone", required: true, minPhotos: 3, stampTag: "before" },
          { id: "deep-condition", type: "rating", label: "Starting condition (1 = rough, 5 = tidy)", min: 1, max: 5, required: true },
        ],
      },
      {
        id: "deep-kitchen",
        title: "Kitchen detail",
        fields: [
          { id: "deep-oven-detail", type: "checkbox", label: "Oven, racks and rangehood degreased", required: true, scoring: { weight: 4, max: 1 } },
          { id: "deep-behind-appliances", type: "checkbox", label: "Moved and cleaned behind fridge / oven where safe", required: true, scoring: { weight: 3, max: 1 } },
          { id: "deep-cupboard-interiors", type: "checkbox", label: "Cupboard and drawer interiors wiped", required: true, scoring: { weight: 3, max: 1 } },
          { id: "deep-kitchen-after", type: "photo", label: "After photos — kitchen detail", required: true, minPhotos: 2, stampTag: "after", evidenceCategory: "KITCHEN" },
        ],
      },
      {
        id: "deep-wet",
        title: "Bathroom detail",
        fields: [
          { id: "deep-grout", type: "checkbox", label: "Grout scrubbed, silicone descaled", required: true, scoring: { weight: 4, max: 1 } },
          { id: "deep-showerhead", type: "checkbox", label: "Showerhead and tapware descaled", required: true, scoring: { weight: 2, max: 1 } },
          { id: "deep-exhaust", type: "checkbox", label: "Exhaust fan cover removed and washed", required: true, scoring: { weight: 2, max: 1 } },
          { id: "deep-wet-after", type: "photo", label: "After photos — bathroom detail", required: true, minPhotos: 2, stampTag: "after", evidenceCategory: "BATHROOM" },
        ],
      },
      {
        id: "deep-general",
        title: "Whole-home detail",
        fields: [
          { id: "deep-skirtings", type: "checkbox", label: "Skirtings, architraves and door frames wiped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "deep-fans", type: "checkbox", label: "Ceiling fans and light fittings dusted", required: true, scoring: { weight: 2, max: 1 } },
          { id: "deep-windows-in", type: "checkbox", label: "Windows cleaned inside, tracks vacuumed", required: true, scoring: { weight: 3, max: 1 } },
          { id: "deep-under-furniture", type: "checkbox", label: "Vacuumed under movable furniture", required: true, scoring: { weight: 2, max: 1 } },
          { id: "deep-extra-found", type: "yesno", label: "Found work beyond the quoted scope?", required: true },
          { id: "deep-extra-notes", type: "longtext", label: "What extra work is needed (for a variation quote)?", required: true, conditional: { fieldId: "deep-extra-found", operator: "equals", value: true } },
          { id: "deep-extra-photos", type: "photo", label: "Photos of the extra work", minPhotos: 1, conditional: { fieldId: "deep-extra-found", operator: "equals", value: true } },
        ],
      },
      {
        id: "deep-signoff",
        title: "Sign-off",
        fields: [
          { id: "deep-hours", type: "number", label: "Hours on site", min: 0, max: 24, step: 0.5, unit: "h", required: true },
          { id: "deep-final", type: "photo", label: "Final after photos", required: true, minPhotos: 3, stampTag: "after", evidenceCategory: "FINAL" },
          { id: "deep-signature", type: "signature", label: "Cleaner sign-off", required: true },
        ],
      },
    ],
    theme: { accentColor: "#5b3f8f", showDividers: true },
  },
};

const postConstruction: StarterTemplate = {
  id: "post-construction",
  name: "Post-construction clean",
  description:
    "Builder's clean: dust, debris, sticker and paint removal, staged rough → detail → final with site-safety capture.",
  serviceType: "POST_CONSTRUCTION",
  kind: "POST_CONSTRUCTION",
  tags: ["Builders clean", "Site safety", "Staged"],
  schema: {
    sections: [
      {
        id: "pc-site",
        title: "Site & safety",
        fields: [
          { id: "pc-induction", type: "yesno", label: "Site induction completed?", required: true },
          { id: "pc-ppe", type: "multiselect", label: "PPE worn", options: ["Hi-vis", "Steel caps", "Gloves", "Safety glasses", "Dust mask / P2"], required: true },
          { id: "pc-hazards", type: "yesno", label: "Hazards on site (trades working, no power, no water)?", required: true, severity: "high" },
          { id: "pc-hazard-notes", type: "longtext", label: "Describe the hazard", required: true, conditional: { fieldId: "pc-hazards", operator: "equals", value: true } },
          { id: "pc-before", type: "photo", label: "Before photos of the whole site", required: true, minPhotos: 4, stampTag: "before" },
        ],
      },
      {
        id: "pc-rough",
        title: "Rough clean",
        fields: [
          { id: "pc-debris", type: "checkbox", label: "Debris and offcuts removed", required: true, scoring: { weight: 3, max: 1 } },
          { id: "pc-vacuum-dust", type: "checkbox", label: "Bulk dust vacuumed from floors and ledges", required: true, scoring: { weight: 3, max: 1 } },
          { id: "pc-debris-volume", type: "select", label: "Rubbish removed", options: ["None", "A few bags", "Half a ute", "Full ute or more"], required: true },
        ],
      },
      {
        id: "pc-detail",
        title: "Detail clean",
        fields: [
          { id: "pc-stickers", type: "checkbox", label: "Stickers and protective film removed from glass and appliances", required: true, scoring: { weight: 3, max: 1 } },
          { id: "pc-paint", type: "checkbox", label: "Paint, silicone and render splatter scraped off", required: true, scoring: { weight: 4, max: 1 } },
          { id: "pc-cabinets", type: "checkbox", label: "Cabinet interiors and drawers vacuumed and wiped", required: true, scoring: { weight: 3, max: 1 } },
          { id: "pc-vents", type: "checkbox", label: "Vents, downlights and exhausts dusted", required: true, scoring: { weight: 2, max: 1 } },
          { id: "pc-windows", type: "checkbox", label: "Windows, frames and tracks cleaned", required: true, scoring: { weight: 3, max: 1 } },
          { id: "pc-damage", type: "yesno", label: "Damage found (scratched glass, chipped tiles, dented cabinetry)?", required: true },
          { id: "pc-damage-photos", type: "photo", label: "Damage photos for the builder", required: true, minPhotos: 1, stampTag: "damage", severity: "high", conditional: { fieldId: "pc-damage", operator: "equals", value: true } },
        ],
      },
      {
        id: "pc-final",
        title: "Final polish & handover",
        fields: [
          { id: "pc-floors-final", type: "checkbox", label: "Floors mopped, edges and corners detailed", required: true, scoring: { weight: 3, max: 1 } },
          { id: "pc-glass-final", type: "checkbox", label: "Mirrors and glass polished streak-free", required: true, scoring: { weight: 2, max: 1 } },
          { id: "pc-second-dust", type: "checkbox", label: "Second dust done after settling", required: true, scoring: { weight: 3, max: 1 } },
          { id: "pc-after", type: "photo", label: "After photos — every room", required: true, minPhotos: 4, stampTag: "after", evidenceCategory: "FINAL" },
          { id: "pc-supervisor", type: "text", label: "Site supervisor who signed off" },
          { id: "pc-signature", type: "signature", label: "Cleaner sign-off", required: true },
        ],
      },
    ],
    theme: { accentColor: "#9a5b1f", showDividers: true },
  },
};

const commercial: StarterTemplate = {
  id: "office-commercial",
  name: "Office / commercial clean",
  description:
    "After-hours commercial round: workstations, amenities, kitchen and waste, with alarm and lock-up capture for the site log.",
  serviceType: "COMMERCIAL_RECURRING",
  kind: "COMMERCIAL",
  tags: ["Commercial", "After hours", "Site log"],
  schema: {
    sections: [
      {
        id: "com-access",
        title: "Access & alarm",
        fields: [
          { id: "com-arrival-time", type: "time", label: "Arrival time", required: true },
          { id: "com-alarm-disarmed", type: "yesno", label: "Alarm disarmed on entry?", required: true },
          { id: "com-alarm-issue", type: "longtext", label: "Alarm / access issue detail", required: true, conditional: { fieldId: "com-alarm-disarmed", operator: "equals", value: false } },
          { id: "com-areas", type: "multiselect", label: "Areas serviced tonight", options: ["Reception", "Open plan", "Meeting rooms", "Kitchen / breakout", "Bathrooms", "Warehouse", "Stairwells"], required: true },
        ],
      },
      {
        id: "com-workspaces",
        title: "Workspaces",
        fields: [
          { id: "com-desks", type: "checkbox", label: "Desks and workstations wiped (around items)", required: true, scoring: { weight: 2, max: 1 } },
          { id: "com-meeting", type: "checkbox", label: "Meeting rooms reset — chairs in, whiteboards cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "com-glass", type: "checkbox", label: "Glass partitions and entry doors spot-cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "com-floors", type: "checkbox", label: "Floors vacuumed / mopped throughout", required: true, scoring: { weight: 3, max: 1 } },
        ],
      },
      {
        id: "com-amenities",
        title: "Amenities & kitchen",
        fields: [
          { id: "com-toilets", type: "checkbox", label: "Toilets and urinals sanitised", required: true, scoring: { weight: 3, max: 1 } },
          { id: "com-consumables", type: "multiselect", label: "Consumables restocked", options: ["Toilet paper", "Hand towel", "Hand soap", "Sanitiser", "Bin liners", "Dishwasher tablets"] },
          { id: "com-consumables-low", type: "yesno", label: "Consumables stock low on site?", required: true },
          { id: "com-consumables-order", type: "longtext", label: "What to deliver next visit", required: true, conditional: { fieldId: "com-consumables-low", operator: "equals", value: true } },
          { id: "com-kitchen", type: "checkbox", label: "Kitchen benches, sink and appliance fronts cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "com-bins", type: "checkbox", label: "All bins emptied to the main waste point, recycling separated", required: true, scoring: { weight: 3, max: 1 } },
          { id: "com-amenity-photo", type: "photo", label: "Photo of finished amenities", required: true, minPhotos: 1, stampTag: "after" },
        ],
      },
      {
        id: "com-lockup",
        title: "Lock-up & site log",
        fields: [
          { id: "com-faults", type: "yesno", label: "Any faults to report (lights, leaks, damage)?", required: true },
          { id: "com-fault-notes", type: "longtext", label: "Fault detail and location", required: true, conditional: { fieldId: "com-faults", operator: "equals", value: true } },
          { id: "com-fault-photos", type: "photo", label: "Fault photos", minPhotos: 1, conditional: { fieldId: "com-faults", operator: "equals", value: true } },
          { id: "com-lights-off", type: "checkbox", label: "Lights off, doors locked, alarm re-armed", required: true, scoring: { weight: 3, max: 1 } },
          { id: "com-depart-time", type: "time", label: "Departure time", required: true },
          { id: "com-signature", type: "signature", label: "Cleaner sign-off", required: true },
        ],
      },
    ],
    theme: { accentColor: "#1f5f7a" },
  },
};

const qaInspection: StarterTemplate = {
  id: "qa-inspection",
  name: "QA inspection",
  description:
    "Supervisor spot-check scored out of 5 per zone — fails force a photo and a rework decision the office can act on.",
  serviceType: "GENERAL_CLEAN",
  kind: "CUSTOM",
  tags: ["Supervisor", "Scored", "Audit"],
  schema: {
    sections: [
      {
        id: "qa-context",
        title: "Inspection details",
        fields: [
          { id: "qa-inspector", type: "text", label: "Inspector name", required: true },
          { id: "qa-cleaner", type: "text", label: "Cleaner / crew inspected", required: true },
          { id: "qa-when", type: "datetime", label: "Inspected at", required: true },
          { id: "qa-type", type: "select", label: "Inspection type", options: ["Routine spot-check", "New client first clean", "Complaint follow-up", "New starter review"], required: true },
        ],
      },
      {
        id: "qa-scores",
        title: "Zone scores",
        description: "1 = must redo, 5 = client-ready.",
        fields: [
          { id: "qa-kitchen-score", type: "rating", label: "Kitchen", min: 1, max: 5, required: true, scoring: { weight: 3, max: 5 } },
          { id: "qa-bathroom-score", type: "rating", label: "Bathrooms", min: 1, max: 5, required: true, scoring: { weight: 3, max: 5 } },
          { id: "qa-bedroom-score", type: "rating", label: "Bedrooms", min: 1, max: 5, required: true, scoring: { weight: 2, max: 5 } },
          { id: "qa-living-score", type: "rating", label: "Living areas", min: 1, max: 5, required: true, scoring: { weight: 2, max: 5 } },
          { id: "qa-floors-score", type: "rating", label: "Floors and edges", min: 1, max: 5, required: true, scoring: { weight: 2, max: 5 } },
          { id: "qa-detail-score", type: "rating", label: "Detail (skirtings, sills, switches)", min: 1, max: 5, required: true, scoring: { weight: 1, max: 5 } },
        ],
      },
      {
        id: "qa-evidence",
        title: "Evidence",
        fields: [
          { id: "qa-photos", type: "photo", label: "Inspection photos", required: true, minPhotos: 3, stampTag: "after" },
          { id: "qa-fail-found", type: "yesno", label: "Any zone below standard?", required: true },
          { id: "qa-fail-zones", type: "multiselect", label: "Which zones failed?", options: ["Kitchen", "Bathrooms", "Bedrooms", "Living", "Floors", "Detail"], required: true, conditional: { fieldId: "qa-fail-found", operator: "equals", value: true } },
          { id: "qa-fail-photos", type: "photo", label: "Photos of every failed item", required: true, minPhotos: 1, severity: "high", stampTag: "damage", conditional: { fieldId: "qa-fail-found", operator: "equals", value: true } },
        ],
      },
      {
        id: "qa-outcome",
        title: "Outcome",
        fields: [
          { id: "qa-action", type: "select", label: "Action required", options: ["None — passed", "Coach the cleaner", "Rework booked", "Escalate to ops manager"], required: true },
          { id: "qa-action-notes", type: "longtext", label: "Notes for the office", helpText: "What must happen next, and by when." },
          { id: "qa-client-informed", type: "yesno", label: "Client informed?", required: true },
          { id: "qa-signature", type: "signature", label: "Inspector signature", required: true },
        ],
      },
    ],
    theme: { accentColor: "#7a1f3f" },
  },
};

const rework: StarterTemplate = {
  id: "rework-re-clean",
  name: "Rework / re-clean",
  description:
    "Complaint response visit — capture what was flagged, fix it, and close the loop with matched before/after evidence.",
  serviceType: "SPECIAL_CLEAN",
  kind: "CUSTOM",
  tags: ["Complaint", "Make good", "Free of charge"],
  schema: {
    sections: [
      {
        id: "rw-complaint",
        title: "What was flagged",
        fields: [
          { id: "rw-source", type: "select", label: "Raised by", options: ["Client", "Property manager", "Guest / tenant", "Internal QA"], required: true },
          { id: "rw-original-date", type: "date", label: "Date of the original clean", required: true },
          { id: "rw-items", type: "multiselect", label: "Areas flagged", options: ["Kitchen", "Bathrooms", "Bedrooms", "Living", "Floors", "Windows", "Balcony / outdoor", "Missed rubbish"], required: true },
          { id: "rw-detail", type: "longtext", label: "Complaint in the client's words", required: true },
          { id: "rw-before", type: "photo", label: "Before photos of every flagged area", required: true, minPhotos: 2, stampTag: "before", severity: "high" },
        ],
      },
      {
        id: "rw-fix",
        title: "Make good",
        fields: [
          { id: "rw-all-addressed", type: "yesno", label: "Every flagged item addressed?", required: true },
          { id: "rw-not-addressed", type: "longtext", label: "What could not be fixed and why", required: true, conditional: { fieldId: "rw-all-addressed", operator: "equals", value: false } },
          { id: "rw-extra-work", type: "checkbox", label: "Additional touch-ups done beyond the complaint" },
          { id: "rw-time-on-site", type: "number", label: "Time on site", min: 0, max: 12, step: 0.25, unit: "h", required: true },
          { id: "rw-after", type: "photo", label: "After photos — same angles as the before shots", required: true, minPhotos: 2, stampTag: "after", evidenceCategory: "FINAL" },
        ],
      },
      {
        id: "rw-root-cause",
        title: "Root cause",
        fields: [
          { id: "rw-cause", type: "select", label: "Most likely cause", options: ["Missed by cleaner", "Not enough time allocated", "Scope not quoted", "Client expectation mismatch", "Damage / pre-existing", "Access problem"], required: true },
          { id: "rw-cause-notes", type: "longtext", label: "Notes for the ops manager" },
          { id: "rw-prevent", type: "longtext", label: "What stops this happening again?", required: true },
        ],
      },
      {
        id: "rw-close",
        title: "Close the loop",
        fields: [
          { id: "rw-client-present", type: "yesno", label: "Client present at the end?", required: true },
          { id: "rw-client-happy", type: "yesno", label: "Client confirmed they are happy?", required: true, conditional: { fieldId: "rw-client-present", operator: "equals", value: true } },
          { id: "rw-client-signature", type: "signature", label: "Client signature", conditional: { fieldId: "rw-client-present", operator: "equals", value: true } },
          { id: "rw-signature", type: "signature", label: "Cleaner sign-off", required: true },
        ],
      },
    ],
    theme: { accentColor: "#a3341f", showDividers: true },
  },
};

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  airbnbTurnover,
  endOfLease,
  recurringHome,
  deepClean,
  postConstruction,
  commercial,
  qaInspection,
  rework,
];

/** Look a blueprint up by its slug (`id`). */
export function getStarterTemplate(id: string): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((t) => t.id === id);
}

/** Section / field counts for the picker cards. */
export function starterTemplateStats(template: StarterTemplate): {
  sections: number;
  fields: number;
  photoFields: number;
} {
  const fields = template.schema.sections.flatMap((s) => s.fields);
  return {
    sections: template.schema.sections.length,
    fields: fields.length,
    photoFields: fields.filter((f) => f.type === "photo" || f.type === "video").length,
  };
}
