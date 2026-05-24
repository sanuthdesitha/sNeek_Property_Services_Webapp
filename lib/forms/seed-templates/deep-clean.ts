import type { FormKind, JobType } from "@prisma/client";
import type { FormSchema } from "../types";

export const deepCleanTemplate: {
  name: string;
  kind: FormKind;
  serviceType: JobType;
  version: number;
  schema: FormSchema;
} = {
  name: "Deep Clean v1",
  kind: "DEEP_CLEAN",
  serviceType: "DEEP_CLEAN",
  version: 1,
  schema: {
    sections: [
      {
        id: "assessment",
        title: "Pre-clean assessment",
        fields: [
          { id: "focus-areas", type: "multiselect", label: "Areas of focus this visit", options: ["Kitchen", "Bathrooms", "Bedrooms", "Living", "Floors", "Windows", "Appliances"] },
          { id: "special-requests", type: "longtext", label: "Client special requests" },
          { id: "before-photos", type: "photo", label: "Before photos (each room)", required: true, minPhotos: 3, scoring: { weight: 2, max: 1 } },
        ],
      },
      {
        id: "surfaces",
        title: "Surfaces (every room)",
        description: "Deep — not just visible surfaces.",
        fields: [
          { id: "skirting-boards", type: "checkbox", label: "Skirting boards wiped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "door-frames", type: "checkbox", label: "Door frames + handles wiped", required: true },
          { id: "light-switches", type: "checkbox", label: "Light switches + power points wiped", required: true },
          { id: "ceiling-fans", type: "checkbox", label: "Ceiling fans dusted", required: true, scoring: { weight: 2, max: 1 } },
          { id: "light-fittings", type: "checkbox", label: "Light fittings dusted / wiped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "vents", type: "checkbox", label: "A/C + heater vents dusted" },
          { id: "blinds", type: "checkbox", label: "Blinds + window dressings dusted", required: true, scoring: { weight: 2, max: 1 } },
        ],
      },
      {
        id: "appliances",
        title: "Appliances",
        fields: [
          { id: "oven-interior", type: "checkbox", label: "Oven interior degreased", required: true, scoring: { weight: 3, max: 1 } },
          { id: "oven-photos", type: "photo", label: "Oven before + after", required: true, minPhotos: 2 },
          { id: "fridge-interior", type: "checkbox", label: "Fridge interior cleaned (with client consent)", scoring: { weight: 2, max: 1 } },
          { id: "dishwasher-clean", type: "checkbox", label: "Dishwasher — filter + interior cleaned" },
          { id: "microwave", type: "checkbox", label: "Microwave interior cleaned", required: true },
          { id: "rangehood", type: "checkbox", label: "Rangehood + filter degreased", required: true, scoring: { weight: 2, max: 1 } },
        ],
      },
      {
        id: "floors",
        title: "Floors",
        fields: [
          { id: "vacuum-all", type: "checkbox", label: "All floors vacuumed (edges + under furniture where possible)", required: true, scoring: { weight: 2, max: 1 } },
          { id: "mop-all", type: "checkbox", label: "Hard floors mopped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "carpet-treatment", type: "checkbox", label: "Carpet spot-treatment applied where needed" },
        ],
      },
      {
        id: "bathrooms",
        title: "Bathrooms (full sanitize)",
        fields: [
          { id: "bath-grout", type: "checkbox", label: "Grout scrubbed / treated", required: true, scoring: { weight: 3, max: 1 } },
          { id: "bath-shower-screen", type: "checkbox", label: "Shower screen — soap scum removed", required: true, scoring: { weight: 2, max: 1 } },
          { id: "bath-toilet-deep", type: "checkbox", label: "Toilet deep-sanitized (top + bottom + base)", required: true, scoring: { weight: 3, max: 1 } },
          { id: "bath-exhaust", type: "checkbox", label: "Exhaust fan cleaned", required: true },
          { id: "bath-photos", type: "photo", label: "Bathroom after photos", required: true, minPhotos: 1 },
        ],
      },
      {
        id: "windows",
        title: "Windows — interior",
        fields: [
          { id: "win-glass", type: "checkbox", label: "Interior glass cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "win-frames", type: "checkbox", label: "Frames + sills wiped", required: true },
          { id: "win-tracks", type: "checkbox", label: "Tracks vacuumed + wiped", required: true },
        ],
      },
      {
        id: "wrap-up",
        title: "Photos + supplies",
        fields: [
          { id: "after-photos", type: "photo", label: "After photos (each room)", required: true, minPhotos: 3, scoring: { weight: 2, max: 1 } },
          { id: "supplies-restocked", type: "multiselect", label: "Supplies restocked", options: ["Toilet paper", "Hand soap", "Bin liners", "Dishwasher tablets", "Spray cleaner"] },
          { id: "signature", type: "signature", label: "Cleaner signature", required: true },
        ],
      },
    ],
  },
};
