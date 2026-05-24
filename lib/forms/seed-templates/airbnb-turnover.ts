import type { FormKind, JobType } from "@prisma/client";
import type { FormSchema } from "../types";

export const airbnbTurnoverTemplate: {
  name: string;
  kind: FormKind;
  serviceType: JobType;
  version: number;
  schema: FormSchema;
} = {
  name: "Airbnb Turnover v2",
  kind: "AIRBNB_TURNOVER",
  serviceType: "AIRBNB_TURNOVER",
  version: 2,
  schema: {
    sections: [
      {
        id: "pre-clean",
        title: "Pre-clean walkthrough",
        description: "Quick assessment before you start.",
        fields: [
          { id: "guest-damage-noted", type: "longtext", label: "Any guest damage noted?", helpText: "If yes, take photo evidence below." },
          { id: "guest-damage-photos", type: "photo", label: "Damage photos (if any)", minPhotos: 0 },
          { id: "left-behind-items", type: "longtext", label: "Items left by guests?", helpText: "Lost & found protocol applies." },
          { id: "left-behind-photos", type: "photo", label: "Photos of left-behind items", minPhotos: 0, conditional: { fieldId: "left-behind-items", equals: true } },
          { id: "smoking-detected", type: "checkbox", label: "Smoking smell or evidence detected?" },
          { id: "pet-evidence", type: "checkbox", label: "Pet hair / evidence detected?" },
        ],
      },
      {
        id: "bedrooms",
        title: "Bedrooms",
        fields: [
          { id: "bed-stripped", type: "checkbox", label: "Beds stripped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "linen-replaced", type: "checkbox", label: "Fresh linen on all beds", required: true, scoring: { weight: 3, max: 1 } },
          { id: "surfaces-wiped", type: "checkbox", label: "Bedside tables / dressers wiped", required: true, scoring: { weight: 1, max: 1 } },
          { id: "mirrors-cleaned", type: "checkbox", label: "Mirrors streak-free" },
          { id: "vacuumed", type: "checkbox", label: "Floor vacuumed / mopped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "wardrobes-checked", type: "checkbox", label: "Wardrobes empty + tidy" },
          { id: "bedroom-photos", type: "photo", label: "Photo each finished bedroom", required: true, minPhotos: 1, scoring: { weight: 2, max: 1 } },
        ],
      },
      {
        id: "bathrooms",
        title: "Bathrooms",
        fields: [
          { id: "toilet-sanitized", type: "checkbox", label: "Toilet sanitized (seat top + bottom + base)", required: true, scoring: { weight: 3, max: 1 } },
          { id: "shower-cleaned", type: "checkbox", label: "Shower + screen cleaned", required: true, scoring: { weight: 3, max: 1 } },
          { id: "basin-cleaned", type: "checkbox", label: "Basin + tap cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "mirror-cleaned", type: "checkbox", label: "Mirror streak-free", required: true },
          { id: "floor-mopped", type: "checkbox", label: "Floor mopped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "toiletries-restocked", type: "checkbox", label: "Toiletries restocked", required: true, scoring: { weight: 2, max: 1 } },
          { id: "towels-fresh", type: "checkbox", label: "Fresh towels placed", required: true, scoring: { weight: 2, max: 1 } },
          { id: "bin-emptied-bathroom", type: "checkbox", label: "Bathroom bin emptied + relined" },
          { id: "bathroom-photos", type: "photo", label: "Photo each finished bathroom", required: true, minPhotos: 1 },
        ],
      },
      {
        id: "kitchen",
        title: "Kitchen",
        fields: [
          { id: "dishes-washed", type: "checkbox", label: "Dishes washed + put away", required: true, scoring: { weight: 2, max: 1 } },
          { id: "benchtops-wiped", type: "checkbox", label: "Benchtops wiped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "stovetop-cleaned", type: "checkbox", label: "Stovetop cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "microwave-cleaned", type: "checkbox", label: "Microwave interior wiped" },
          { id: "fridge-checked", type: "checkbox", label: "Fridge — guest leftovers cleared" },
          { id: "dishwasher-emptied", type: "checkbox", label: "Dishwasher emptied" },
          { id: "bin-emptied-kitchen", type: "checkbox", label: "Kitchen bin emptied + relined", required: true, scoring: { weight: 2, max: 1 } },
          { id: "essentials-restocked", type: "multiselect", label: "Essentials restocked", options: ["Dish soap", "Sponge", "Paper towel", "Coffee pods", "Tea", "Sugar", "Salt + pepper"] },
          { id: "kitchen-photos", type: "photo", label: "Photo finished kitchen", required: true, minPhotos: 1 },
        ],
      },
      {
        id: "living",
        title: "Living areas",
        fields: [
          { id: "surfaces-dusted", type: "checkbox", label: "Surfaces dusted + wiped", required: true },
          { id: "vacuumed-living", type: "checkbox", label: "Floor vacuumed / mopped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "cushions-arranged", type: "checkbox", label: "Cushions / throws arranged" },
          { id: "tv-remote", type: "checkbox", label: "Remote + tech reset to home screen" },
          { id: "living-photos", type: "photo", label: "Photo finished living area", required: true, minPhotos: 1 },
        ],
      },
      {
        id: "laundry",
        title: "Laundry / linen",
        description: "Confirm with photo so laundry can be notified.",
        fields: [
          { id: "laundry-ready", type: "checkbox", label: "Laundry bagged + ready for pickup", helpText: "Triggers laundry notification when toggled on with photo." },
          { id: "laundry-photo", type: "photo", label: "Photo of bagged laundry", minPhotos: 1, conditional: { fieldId: "laundry-ready", equals: true } },
          { id: "bag-location", type: "text", label: "Bag location (e.g. front porch, garage)", conditional: { fieldId: "laundry-ready", equals: true } },
          { id: "laundry-skip-reason", type: "select", label: "Skip reason (if not ready)", options: ["No window", "Express turnover", "Linen on-site reused", "Other"], conditional: { fieldId: "laundry-ready", equals: false } },
        ],
      },
      {
        id: "final-inspection",
        title: "Final inspection",
        fields: [
          { id: "overall-walk", type: "checkbox", label: "Overall walkthrough done", required: true, scoring: { weight: 2, max: 1 } },
          { id: "windows-locked", type: "checkbox", label: "Windows / doors locked", required: true, scoring: { weight: 3, max: 1 } },
          { id: "aircon-set", type: "checkbox", label: "A/C set to default + off" },
          { id: "lights-off", type: "checkbox", label: "Lights off", required: true },
          { id: "key-returned", type: "select", label: "Keys / lockbox status", options: ["Returned to lockbox", "Returned to host", "Left on bench"], required: true },
          { id: "final-photo", type: "photo", label: "Final overview photo", required: true, minPhotos: 1 },
          { id: "cleaner-signature", type: "signature", label: "Cleaner signature", required: true },
        ],
      },
      {
        id: "supplies-used",
        title: "Supplies used",
        fields: [
          { id: "supplies", type: "multiselect", label: "Supplies used this clean", options: ["Toilet paper", "Hand soap", "Body wash", "Shampoo", "Conditioner", "Tea towel", "Bin liner", "Dishwasher tablet", "Laundry pod"] },
          { id: "supply-notes", type: "longtext", label: "Notes / shortages to flag" },
        ],
      },
    ],
  },
};
