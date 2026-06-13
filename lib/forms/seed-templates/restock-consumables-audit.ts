import type { FormKind, JobType } from "@prisma/client";
import type { FormSchema } from "../types";

// Dedicated supplies / consumables audit run between turnovers so hosts never
// run out. Counts on-hand stock per area and flags reorders.
export const restockConsumablesAuditTemplate: {
  name: string;
  kind: FormKind;
  serviceType: JobType;
  version: number;
  schema: FormSchema;
} = {
  name: "Restock & Consumables Audit v1",
  kind: "CUSTOM",
  serviceType: "GENERAL_CLEAN",
  version: 1,
  schema: {
    theme: {
      accentColor: "#16a34a",
      headerColor: "#14532d",
      showDividers: true,
    },
    sections: [
      {
        id: "rc-bathroom",
        title: "Bathroom consumables",
        fields: [
          { id: "rc-toilet-paper", type: "counter", label: "Toilet paper rolls on hand", min: 0, step: 1, unit: "rolls", locationTag: "Bathroom" },
          { id: "rc-hand-soap", type: "counter", label: "Hand soap refills", min: 0, step: 1, locationTag: "Bathroom" },
          {
            id: "rc-amenities",
            type: "multiselect",
            label: "Amenities present",
            options: ["Shampoo", "Conditioner", "Body wash", "Soap bars", "Cotton buds", "Shower cap"],
            locationTag: "Bathroom",
            references: [
              {
                kind: "image",
                url: "https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=800",
                caption: "Full amenity set reference",
              },
            ],
          },
          { id: "rc-bathroom-restock", type: "yesno", label: "Bathroom restock needed?", includeNa: false },
        ],
      },
      {
        id: "rc-kitchen",
        title: "Kitchen consumables",
        fields: [
          { id: "rc-dish-soap", type: "counter", label: "Dish soap bottles", min: 0, step: 1, locationTag: "Kitchen" },
          { id: "rc-paper-towel", type: "counter", label: "Paper towel rolls", min: 0, step: 1, unit: "rolls", locationTag: "Kitchen" },
          { id: "rc-dishwasher-tabs", type: "counter", label: "Dishwasher tablets", min: 0, step: 1, locationTag: "Kitchen" },
          { id: "rc-pantry", type: "multiselect", label: "Pantry / welcome items present", options: ["Coffee pods", "Tea", "Sugar", "Salt", "Pepper", "Oil", "Bin liners"], locationTag: "Kitchen" },
          { id: "rc-kitchen-restock", type: "yesno", label: "Kitchen restock needed?", includeNa: false },
        ],
      },
      {
        id: "rc-linen",
        title: "Linen & towels",
        fields: [
          { id: "rc-bed-sets", type: "counter", label: "Spare bed-linen sets", min: 0, step: 1, locationTag: "Linen closet" },
          { id: "rc-bath-towels", type: "counter", label: "Spare bath towels", min: 0, step: 1, locationTag: "Linen closet" },
          { id: "rc-hand-towels", type: "counter", label: "Spare hand towels", min: 0, step: 1, locationTag: "Linen closet" },
          { id: "rc-linen-condition", type: "rating", label: "Linen condition", max: 5 },
        ],
      },
      {
        id: "rc-cleaning",
        title: "Cleaning supplies",
        fields: [
          { id: "rc-supplies", type: "multiselect", label: "Cleaning supplies in stock", options: ["All-purpose spray", "Glass cleaner", "Bathroom cleaner", "Bleach", "Sponges", "Cloths", "Vacuum bags", "Mop heads"] },
          { id: "rc-supplies-low", type: "longtext", label: "Anything running low?" },
          { id: "rc-supplies-photo", type: "photo", label: "Photo of supply cupboard", minPhotos: 0 },
        ],
      },
      {
        id: "rc-order",
        title: "Reorder summary",
        fields: [
          { id: "rc-reorder-now", type: "yesno", label: "Place a reorder now?", required: true, includeNa: false },
          { id: "rc-reorder-list", type: "longtext", label: "Reorder list", conditional: { fieldId: "rc-reorder-now", operator: "equals", value: true } },
          { id: "rc-priority", type: "select", label: "Reorder priority", options: ["Routine", "Soon", "Urgent"], conditional: { fieldId: "rc-reorder-now", operator: "equals", value: true } },
          { id: "rc-signature", type: "signature", label: "Auditor signature", required: true },
        ],
      },
    ],
  },
};
