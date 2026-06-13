import type { FormKind, JobType } from "@prisma/client";
import type { FormSchema } from "../types";

// Fast, photo-light turnover for studios / 1-bedroom listings where speed
// matters and the cleaner needs the essentials only.
export const airbnbExpressTurnoverTemplate: {
  name: string;
  kind: FormKind;
  serviceType: JobType;
  version: number;
  schema: FormSchema;
} = {
  name: "Airbnb Express Turnover (studio/1BR) v1",
  kind: "AIRBNB_TURNOVER",
  serviceType: "AIRBNB_TURNOVER",
  version: 3,
  schema: {
    theme: {
      accentColor: "#e11d48",
      headerColor: "#881337",
      showDividers: true,
      headingFont: "'Trebuchet MS', sans-serif",
    },
    sections: [
      {
        id: "express-arrival",
        title: "Arrival check",
        description: "30-second sweep before you start.",
        fields: [
          { id: "ex-guest-gone", type: "yesno", label: "Guest checked out / property empty?", required: true },
          { id: "ex-damage", type: "yesno", label: "Any obvious damage?", detailsWhenNo: false, includeNa: false },
          { id: "ex-damage-photos", type: "photo", label: "Damage photos (if any)", minPhotos: 0, conditional: { fieldId: "ex-damage", operator: "equals", value: true } },
          { id: "ex-left-items", type: "checkbox", label: "Items left behind (log to lost & found)" },
        ],
      },
      {
        id: "express-sleep",
        title: "Sleep + bath",
        fields: [
          {
            id: "ex-linen",
            type: "checkbox",
            label: "Fresh linen on the bed",
            required: true,
            locationTag: "Bedroom",
            severity: "high",
            scoring: { weight: 3, max: 1 },
            references: [
              {
                kind: "image",
                url: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=800",
                caption: "Hospital corners, cushions front-and-centre",
              },
            ],
          },
          { id: "ex-bath", type: "checkbox", label: "Bathroom cleaned + sanitized", required: true, locationTag: "Bathroom", scoring: { weight: 3, max: 1 } },
          {
            id: "ex-towels",
            type: "checkbox",
            label: "Fresh towels fanned / rolled",
            required: true,
            locationTag: "Bathroom",
            references: [
              {
                kind: "image",
                url: "https://images.unsplash.com/photo-1620626011761-996317b8d101?w=800",
                caption: "Towel presentation standard",
              },
            ],
          },
          { id: "ex-toiletries", type: "checkbox", label: "Toiletries + amenities restocked", required: true },
        ],
      },
      {
        id: "express-living",
        title: "Living + kitchenette",
        fields: [
          { id: "ex-surfaces", type: "checkbox", label: "Surfaces wiped + dusted", required: true },
          { id: "ex-dishes", type: "checkbox", label: "Dishes done + put away", required: true, locationTag: "Kitchen" },
          { id: "ex-bins", type: "checkbox", label: "All bins emptied + relined", required: true },
          { id: "ex-floors", type: "checkbox", label: "Floors vacuumed / mopped", required: true, scoring: { weight: 2, max: 1 } },
        ],
      },
      {
        id: "express-finish",
        title: "Final + photos",
        fields: [
          { id: "ex-presentation", type: "checkbox", label: "Welcome presentation set (remotes, A/C, lights)" },
          { id: "ex-locked", type: "checkbox", label: "Windows / doors locked", required: true, severity: "high" },
          { id: "ex-photo-overall", type: "photo", label: "Final overview photo", required: true, minPhotos: 1 },
          { id: "ex-rating", type: "rating", label: "Self-assessed finish quality", max: 5 },
          { id: "ex-notes", type: "longtext", label: "Notes for host" },
        ],
      },
    ],
  },
};
