import type { FormKind, JobType } from "@prisma/client";
import type { FormSchema } from "../types";

// Lighter template for recurring weekly / fortnightly maintenance cleans.
export const regularMaintenanceTemplate: {
  name: string;
  kind: FormKind;
  serviceType: JobType;
  version: number;
  schema: FormSchema;
} = {
  name: "Regular Maintenance Clean v1",
  kind: "REGULAR_MAINTENANCE",
  serviceType: "GENERAL_CLEAN",
  version: 1,
  schema: {
    sections: [
      {
        id: "kitchen-quick",
        title: "Kitchen — quick clean",
        fields: [
          { id: "k-benches", type: "checkbox", label: "Benchtops wiped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "k-stovetop", type: "checkbox", label: "Stovetop wiped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "k-sink", type: "checkbox", label: "Sink + taps polished", required: true },
          { id: "k-bin", type: "checkbox", label: "Bin emptied + relined", required: true, scoring: { weight: 2, max: 1 } },
          { id: "k-floor", type: "checkbox", label: "Kitchen floor swept + mopped", required: true },
        ],
      },
      {
        id: "bathrooms-quick",
        title: "Bathrooms — quick clean",
        fields: [
          { id: "b-toilet", type: "checkbox", label: "Toilet cleaned + sanitized", required: true, scoring: { weight: 2, max: 1 } },
          { id: "b-basin", type: "checkbox", label: "Basin + tap polished", required: true },
          { id: "b-mirror", type: "checkbox", label: "Mirror streak-free", required: true },
          { id: "b-shower-wipe", type: "checkbox", label: "Shower / screen wiped down", required: true, scoring: { weight: 2, max: 1 } },
          { id: "b-floor", type: "checkbox", label: "Bathroom floor mopped", required: true },
        ],
      },
      {
        id: "floors",
        title: "Floors",
        fields: [
          { id: "f-vacuum-high-traffic", type: "checkbox", label: "High-traffic areas vacuumed", required: true, scoring: { weight: 2, max: 1 } },
          { id: "f-mop-hard", type: "checkbox", label: "Hard floors mopped", required: true, scoring: { weight: 2, max: 1 } },
        ],
      },
      {
        id: "surfaces",
        title: "Surfaces",
        fields: [
          { id: "s-dust-visible", type: "checkbox", label: "Visible surfaces dusted + wiped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "s-mirrors", type: "checkbox", label: "Mirrors / glass cleaned" },
        ],
      },
      {
        id: "bedrooms",
        title: "Bedrooms",
        fields: [
          { id: "br-make-beds", type: "checkbox", label: "Beds made (if requested)" },
          { id: "br-vacuum", type: "checkbox", label: "Bedroom floors vacuumed" },
          { id: "br-tidy", type: "checkbox", label: "Bedrooms tidied" },
        ],
      },
      {
        id: "wrap",
        title: "Photos + sign-off",
        fields: [
          { id: "after-photos", type: "photo", label: "After photos (each main room)", required: true, minPhotos: 2 },
          { id: "client-notes", type: "longtext", label: "Notes for client / next visit" },
          { id: "signature", type: "signature", label: "Cleaner signature", required: true },
        ],
      },
    ],
  },
};
