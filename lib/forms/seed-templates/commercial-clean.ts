import type { FormKind, JobType } from "@prisma/client";
import type { FormSchema } from "../types";

export const commercialCleanTemplate: {
  name: string;
  kind: FormKind;
  serviceType: JobType;
  version: number;
  schema: FormSchema;
} = {
  name: "Commercial Clean v1",
  kind: "COMMERCIAL",
  serviceType: "COMMERCIAL_RECURRING",
  version: 1,
  schema: {
    sections: [
      {
        id: "common-areas",
        title: "Common areas",
        fields: [
          { id: "ca-reception", type: "checkbox", label: "Reception cleaned + tidied", required: true, scoring: { weight: 2, max: 1 } },
          { id: "ca-hallways", type: "checkbox", label: "Hallways vacuumed + mopped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "ca-stairs", type: "checkbox", label: "Stairs vacuumed (if applicable)" },
          { id: "ca-lifts", type: "checkbox", label: "Lift interiors wiped (if applicable)" },
          { id: "ca-glass-doors", type: "checkbox", label: "Entry glass doors polished", required: true },
        ],
      },
      {
        id: "workstations",
        title: "Workstations",
        description: "Only with explicit consent — do not move personal items.",
        fields: [
          { id: "ws-consent", type: "checkbox", label: "Consent confirmed to clean workstations", required: true },
          { id: "ws-desks", type: "checkbox", label: "Desks wiped (clear surfaces only)", conditional: { fieldId: "ws-consent", equals: true } },
          { id: "ws-monitors", type: "checkbox", label: "Monitors dusted (screen-safe spray)", conditional: { fieldId: "ws-consent", equals: true } },
          { id: "ws-phones", type: "checkbox", label: "Phones sanitized", conditional: { fieldId: "ws-consent", equals: true } },
          { id: "ws-keyboards", type: "checkbox", label: "Keyboards dusted (no liquid)", conditional: { fieldId: "ws-consent", equals: true } },
        ],
      },
      {
        id: "kitchen",
        title: "Kitchen / break room",
        fields: [
          { id: "kit-benches", type: "checkbox", label: "Benchtops cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "kit-sink", type: "checkbox", label: "Sink + taps polished", required: true },
          { id: "kit-fridge-exterior", type: "checkbox", label: "Fridge exterior wiped", required: true },
          { id: "kit-microwave", type: "checkbox", label: "Microwave interior + exterior cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "kit-dishwasher", type: "checkbox", label: "Dishwasher loaded / unloaded if required" },
          { id: "kit-coffee", type: "checkbox", label: "Coffee station tidied" },
          { id: "kit-floor", type: "checkbox", label: "Kitchen floor mopped", required: true, scoring: { weight: 2, max: 1 } },
        ],
      },
      {
        id: "bathrooms",
        title: "Bathrooms",
        description: "Commercial-grade sanitize.",
        fields: [
          { id: "bath-toilets", type: "checkbox", label: "All toilets sanitized", required: true, scoring: { weight: 3, max: 1 } },
          { id: "bath-urinals", type: "checkbox", label: "Urinals sanitized (if applicable)" },
          { id: "bath-basins", type: "checkbox", label: "Basins + taps polished", required: true, scoring: { weight: 2, max: 1 } },
          { id: "bath-mirrors", type: "checkbox", label: "Mirrors polished", required: true },
          { id: "bath-floors", type: "checkbox", label: "Bathroom floors mopped + sanitized", required: true, scoring: { weight: 2, max: 1 } },
          { id: "bath-restock", type: "multiselect", label: "Restocked", options: ["Toilet paper", "Paper towel", "Hand soap", "Hand sanitizer"], required: true, scoring: { weight: 2, max: 1 } },
          { id: "bath-photos", type: "photo", label: "Bathroom after photos", required: true, minPhotos: 1 },
        ],
      },
      {
        id: "bins",
        title: "Bins",
        fields: [
          { id: "bins-emptied", type: "checkbox", label: "All bins emptied + relined", required: true, scoring: { weight: 2, max: 1 } },
          { id: "bins-rinsed", type: "checkbox", label: "Bins rinsed if soiled" },
          { id: "bins-to-skip", type: "checkbox", label: "Waste to skip / collection area", required: true },
        ],
      },
      {
        id: "glass",
        title: "Glass",
        fields: [
          { id: "gl-partitions", type: "checkbox", label: "Interior glass partitions polished", required: true },
          { id: "gl-doors", type: "checkbox", label: "Glass doors polished", required: true, scoring: { weight: 2, max: 1 } },
          { id: "gl-meeting-rooms", type: "checkbox", label: "Meeting room glass cleaned" },
        ],
      },
      {
        id: "signoff",
        title: "Sign-off",
        fields: [
          { id: "after-photos", type: "photo", label: "After photos (common areas + bathrooms)", required: true, minPhotos: 3 },
          { id: "issues-log", type: "longtext", label: "Issues / requests to log with facilities" },
          { id: "facilities-signature", type: "signature", label: "Facilities manager signature (if on site)" },
          { id: "cleaner-signature", type: "signature", label: "Cleaner signature", required: true },
        ],
      },
    ],
  },
};
