import type { FormKind, JobType } from "@prisma/client";
import type { FormSchema } from "../types";

export const carpetCleanTemplate: {
  name: string;
  kind: FormKind;
  serviceType: JobType;
  version: number;
  schema: FormSchema;
} = {
  name: "Carpet Steam Clean v1",
  kind: "CARPET",
  serviceType: "CARPET_STEAM_CLEAN",
  version: 1,
  schema: {
    sections: [
      {
        id: "pre-vacuum",
        title: "Pre-vacuum",
        description: "Always pre-vacuum to lift loose debris before steam.",
        fields: [
          { id: "pre-vac-all", type: "checkbox", label: "All carpeted areas pre-vacuumed", required: true, scoring: { weight: 3, max: 1 } },
          { id: "edges-corners", type: "checkbox", label: "Edges + corners vacuumed (crevice tool)", required: true, scoring: { weight: 2, max: 1 } },
        ],
      },
      {
        id: "stain-log",
        title: "Stain log",
        description: "Photo pre-existing stains as CYA. Note whether removable.",
        fields: [
          { id: "stains-present", type: "checkbox", label: "Pre-existing stains observed" },
          { id: "stain-photos", type: "photo", label: "Photos of stains (with description)", minPhotos: 0, conditional: { fieldId: "stains-present", equals: true } },
          { id: "stain-notes", type: "longtext", label: "Stain notes (type / location / removable?)", conditional: { fieldId: "stains-present", equals: true } },
        ],
      },
      {
        id: "pre-treatment",
        title: "Pre-treatment",
        fields: [
          { id: "pre-treat-high-traffic", type: "checkbox", label: "High-traffic lanes pre-treated", required: true, scoring: { weight: 2, max: 1 } },
          { id: "pre-treat-stains", type: "checkbox", label: "Stains pre-treated", required: true, scoring: { weight: 2, max: 1 } },
          { id: "dwell-time", type: "number", label: "Pre-treatment dwell time (minutes)" },
        ],
      },
      {
        id: "extraction",
        title: "Steam extraction",
        fields: [
          { id: "ext-pass-1", type: "checkbox", label: "Extraction pass 1 complete (all rooms)", required: true, scoring: { weight: 3, max: 1 } },
          { id: "ext-pass-2", type: "checkbox", label: "Extraction pass 2 (high-traffic only)", scoring: { weight: 2, max: 1 } },
          { id: "rooms-cleaned", type: "multiselect", label: "Rooms cleaned", options: ["Lounge", "Dining", "Bedroom 1", "Bedroom 2", "Bedroom 3", "Hallway", "Stairs", "Other"] },
        ],
      },
      {
        id: "drying",
        title: "Drying",
        fields: [
          { id: "fans-deployed", type: "checkbox", label: "Air movers / fans deployed" },
          { id: "drying-time-est", type: "number", label: "Estimated drying time (hours)", required: true },
          { id: "client-advised", type: "checkbox", label: "Client advised on walking + furniture placement", required: true, scoring: { weight: 2, max: 1 } },
        ],
      },
      {
        id: "photos",
        title: "Photos",
        fields: [
          { id: "before-photos", type: "photo", label: "Before photos (each room)", required: true, minPhotos: 2, scoring: { weight: 2, max: 1 } },
          { id: "after-photos", type: "photo", label: "After photos (each room)", required: true, minPhotos: 2, scoring: { weight: 2, max: 1 } },
          { id: "receipt-photo", type: "photo", label: "Receipt / job sheet photo", minPhotos: 0 },
          { id: "signature", type: "signature", label: "Cleaner signature", required: true },
        ],
      },
    ],
  },
};
