import { buildQaTemplate, qaSection } from "./_helpers";

/**
 * QA inspection for regular maintenance / recurring cleans.
 * Focus: consistency, expected scope coverage, ongoing standards.
 */
export const qaRegularMaintenanceTemplate = buildQaTemplate({
  name: "Regular Maintenance Clean — QA Inspection v1",
  serviceType: "GENERAL_CLEAN",
  sections: [
    qaSection(
      "kitchen",
      "Kitchen — QA Inspection",
      [
        { id: "benchtops", label: "Benchtops + splashback wiped, no marks?", weight: 2 },
        { id: "appliance-ext", label: "Appliance exteriors wiped (oven, microwave, fridge)?" },
        { id: "stovetop", label: "Stovetop cleaned, no buildup?", weight: 2 },
        { id: "sink", label: "Sink + tap polished, dishes done?" },
        { id: "floor", label: "Floor swept + mopped?" },
      ]
    ),
    qaSection(
      "bathrooms",
      "Bathrooms — QA Inspection",
      [
        { id: "toilet", label: "Toilet sanitized (seat, base, behind)?", weight: 2 },
        { id: "shower", label: "Shower / tub wiped, screen clean?", weight: 2 },
        { id: "basin", label: "Basin + tap + mirror streak-free?" },
        { id: "floor", label: "Floor mopped?" },
      ]
    ),
    qaSection(
      "living-bedrooms",
      "Living + bedrooms — QA Inspection",
      [
        { id: "surfaces", label: "Surfaces dusted + wiped?", weight: 2 },
        { id: "floors", label: "Floors vacuumed / mopped throughout?", weight: 2 },
        { id: "soft", label: "Cushions / beds tidied to client standard?" },
        { id: "bins", label: "Bins emptied + relined?" },
      ]
    ),
    qaSection(
      "client-specifics",
      "Client-specific instructions",
      [
        { id: "instructions-followed", label: "Any property-specific instructions followed (notes, special items)?", weight: 2 },
        { id: "special-requests", label: "Any one-off requests this visit completed?" },
        { id: "consistency", label: "Quality consistent with prior visits — no regression?", weight: 2 },
      ]
    ),
  ],
});
