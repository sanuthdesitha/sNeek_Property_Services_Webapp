import type { FormKind, JobType } from "@prisma/client";
import type { FormSchema } from "../types";

// Light "while guest is away" refresh during a longer stay — tidy + restock,
// no full strip-down. Guests may have personal items, so handle with care.
export const midStayRefreshTemplate: {
  name: string;
  kind: FormKind;
  serviceType: JobType;
  version: number;
  schema: FormSchema;
} = {
  name: "Mid-stay Refresh v1",
  kind: "REGULAR_MAINTENANCE",
  serviceType: "GENERAL_CLEAN",
  version: 2,
  schema: {
    theme: {
      accentColor: "#0ea5e9",
      headerColor: "#0c4a6e",
      showDividers: true,
    },
    sections: [
      {
        id: "ms-brief",
        title: "Before you start",
        fields: [
          { id: "ms-guest-present", type: "yesno", label: "Are guests currently present?", required: true, includeNa: false },
          { id: "ms-instructions", type: "instruction", label: "Respect guest belongings", helpText: "Do not move or pack personal items. Refresh around them." },
          { id: "ms-access-ok", type: "checkbox", label: "Access confirmed (key / code worked)", required: true },
        ],
      },
      {
        id: "ms-bathroom",
        title: "Bathroom refresh",
        fields: [
          { id: "ms-toilet", type: "checkbox", label: "Toilet wiped + sanitized", required: true, locationTag: "Bathroom" },
          { id: "ms-shower-wipe", type: "checkbox", label: "Shower / basin wiped", required: true, locationTag: "Bathroom" },
          { id: "ms-towels-swap", type: "checkbox", label: "Towels swapped for fresh", required: true },
          { id: "ms-toiletries-top", type: "multiselect", label: "Toiletries topped up", options: ["Hand soap", "Body wash", "Shampoo", "Conditioner", "Toilet paper", "Tissues"] },
        ],
      },
      {
        id: "ms-living",
        title: "Living & kitchen tidy",
        fields: [
          { id: "ms-dishes", type: "checkbox", label: "Dishes done / dishwasher run", locationTag: "Kitchen" },
          { id: "ms-bins", type: "checkbox", label: "Bins emptied + relined", required: true },
          { id: "ms-surfaces", type: "checkbox", label: "Visible surfaces wiped", required: true },
          { id: "ms-floor", type: "checkbox", label: "Floors quick vacuum / spot mop", required: true },
          { id: "ms-restock-kitchen", type: "multiselect", label: "Kitchen consumables topped up", options: ["Dish soap", "Sponge", "Paper towel", "Coffee", "Tea", "Sugar"] },
        ],
      },
      {
        id: "ms-bedroom",
        title: "Bedroom refresh",
        fields: [
          {
            id: "ms-bed-tidy",
            type: "checkbox",
            label: "Bed remade / straightened",
            references: [
              {
                kind: "image",
                url: "https://images.unsplash.com/photo-1560185007-cde436f6a4d0?w=800",
                caption: "Tidy bed standard for a refresh",
              },
            ],
          },
          { id: "ms-bedroom-floor", type: "checkbox", label: "Bedroom floor vacuumed" },
        ],
      },
      {
        id: "ms-wrap",
        title: "Wrap up",
        fields: [
          { id: "ms-issues", type: "yesno", label: "Anything to flag to the host?", includeNa: false, detailsWhenNo: false },
          { id: "ms-issue-photos", type: "photo", label: "Photos of anything flagged", minPhotos: 0, conditional: { fieldId: "ms-issues", operator: "equals", value: true } },
          { id: "ms-final-photo", type: "photo", label: "Quick finished photo", required: true, minPhotos: 1 },
          { id: "ms-notes", type: "longtext", label: "Notes for host / next visit" },
        ],
      },
    ],
  },
};
