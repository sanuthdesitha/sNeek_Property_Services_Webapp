import type { FormKind, JobType } from "@prisma/client";
import type { FormSchema } from "../types";

// High-touch turnover for premium villas: detail-heavy, photo-required, with
// presentation standards and amenity staging.
export const luxuryVillaTurnoverTemplate: {
  name: string;
  kind: FormKind;
  serviceType: JobType;
  version: number;
  schema: FormSchema;
} = {
  name: "Luxury Villa Turnover v1",
  kind: "AIRBNB_TURNOVER",
  serviceType: "AIRBNB_TURNOVER",
  version: 4,
  schema: {
    theme: {
      accentColor: "#b8860b",
      headerColor: "#1c1917",
      showDividers: true,
      headingFont: "Georgia, 'Times New Roman', serif",
      bodyFont: "Georgia, 'Times New Roman', serif",
    },
    sections: [
      {
        id: "villa-arrival",
        title: "Arrival & condition",
        fields: [
          { id: "lv-walkthrough", type: "checkbox", label: "Full walkthrough completed", required: true },
          { id: "lv-damage", type: "yesno", label: "Damage or maintenance issues?", includeNa: false },
          { id: "lv-damage-photos", type: "photo", label: "Document any issues", minPhotos: 0, conditional: { fieldId: "lv-damage", operator: "equals", value: true } },
          { id: "lv-inventory-check", type: "checkbox", label: "Inventory / valuables present & intact" },
        ],
      },
      {
        id: "villa-bedrooms",
        title: "Bedrooms (per room)",
        fields: [
          { id: "lv-room-tag", type: "text", label: "Room name / tag", placeholder: "e.g. Master suite", locationTag: "Bedroom" },
          {
            id: "lv-bed-styling",
            type: "checkbox",
            label: "Bed styled to villa standard",
            required: true,
            severity: "high",
            scoring: { weight: 3, max: 1 },
            references: [
              {
                kind: "image",
                url: "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=800",
                caption: "Five-star bed styling reference",
              },
              {
                kind: "image",
                url: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=800",
                caption: "Cushion + throw arrangement",
              },
            ],
          },
          { id: "lv-surfaces", type: "checkbox", label: "All surfaces polished + dust-free", required: true },
          { id: "lv-wardrobe", type: "checkbox", label: "Wardrobe + drawers emptied & wiped" },
          { id: "lv-room-photo", type: "photo", label: "Finished bedroom photo", required: true, minPhotos: 1 },
        ],
      },
      {
        id: "villa-bathrooms",
        title: "Bathrooms & ensuites",
        fields: [
          { id: "lv-shower", type: "checkbox", label: "Shower glass squeegeed streak-free", required: true, locationTag: "Bathroom", severity: "high", scoring: { weight: 3, max: 1 } },
          { id: "lv-fixtures", type: "checkbox", label: "Chrome / fixtures polished", required: true, locationTag: "Bathroom" },
          {
            id: "lv-amenities",
            type: "checkbox",
            label: "Premium amenities staged",
            required: true,
            references: [
              {
                kind: "image",
                url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800",
                caption: "Amenity tray layout",
              },
            ],
          },
          { id: "lv-towels", type: "checkbox", label: "Towels folded to standard + bath mat", required: true },
          { id: "lv-bathroom-photo", type: "photo", label: "Finished bathroom photo", required: true, minPhotos: 1 },
        ],
      },
      {
        id: "villa-living",
        title: "Living, kitchen & outdoor",
        fields: [
          { id: "lv-kitchen", type: "checkbox", label: "Kitchen deep-wiped + appliances cleaned", required: true, locationTag: "Kitchen", scoring: { weight: 2, max: 1 } },
          { id: "lv-glassware", type: "checkbox", label: "Glassware / crockery polished + stored" },
          { id: "lv-living", type: "checkbox", label: "Living areas dusted, styled, vacuumed", required: true, locationTag: "Living" },
          { id: "lv-outdoor", type: "checkbox", label: "Outdoor / pool deck tidied", locationTag: "Outdoor" },
          { id: "lv-pool-photo", type: "photo", label: "Outdoor / pool area photo", minPhotos: 0, locationTag: "Outdoor" },
        ],
      },
      {
        id: "villa-laundry",
        title: "Laundry / linen",
        description: "Confirm so laundry can be notified.",
        fields: [
          { id: "lv-laundry-ready", type: "checkbox", label: "Laundry bagged + ready for pickup" },
          { id: "lv-laundry-photo", type: "photo", label: "Photo of bagged laundry", minPhotos: 1, conditional: { fieldId: "lv-laundry-ready", operator: "equals", value: true } },
        ],
      },
      {
        id: "villa-final",
        title: "Final presentation",
        fields: [
          { id: "lv-scent", type: "checkbox", label: "Welcome scent / ambience set" },
          { id: "lv-welcome", type: "checkbox", label: "Welcome note / gift placed" },
          { id: "lv-secured", type: "checkbox", label: "Property secured (windows, doors, safe)", required: true, severity: "high" },
          { id: "lv-final-photo", type: "photo", label: "Hero / final overview photos", required: true, minPhotos: 2 },
          { id: "lv-quality", type: "rating", label: "Presentation rating", max: 5 },
          { id: "lv-signature", type: "signature", label: "Cleaner signature", required: true },
        ],
      },
    ],
  },
};
