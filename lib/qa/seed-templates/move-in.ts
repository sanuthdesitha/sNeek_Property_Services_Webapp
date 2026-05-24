import { buildQaTemplate, qaSection } from "./_helpers";

/**
 * QA inspection for move-in cleans (tenant moving in to clean property).
 * Maps to JobType GENERAL_CLEAN (no exact move-in JobType in enum).
 */
export const qaMoveInTemplate = buildQaTemplate({
  name: "Move-In Clean — QA Inspection v1",
  serviceType: "GENERAL_CLEAN",
  sections: [
    qaSection(
      "kitchen",
      "Kitchen — Move-in inspection",
      [
        { id: "cupboards", label: "Inside all cupboards + drawers wiped + dry?", weight: 2 },
        { id: "appliances", label: "Appliances cleaned interior + exterior (oven, fridge, microwave)?", weight: 2 },
        { id: "benchtops", label: "Benchtops + splashback sanitized?" },
        { id: "sink", label: "Sink polished, plug + drain hair / debris-free?" },
        { id: "floor", label: "Floor swept + mopped, no leftover dust?" },
      ]
    ),
    qaSection(
      "bathrooms",
      "Bathrooms — Move-in inspection",
      [
        { id: "deep-sanit", label: "Deep-sanitised — would you happily use it day one?", weight: 3 },
        { id: "shower", label: "Shower screen + tiles + grout clean?", weight: 2 },
        { id: "toilet", label: "Toilet detailed inside + out?", weight: 2 },
        { id: "vanity", label: "Vanity drawers / cabinets wiped inside?" },
        { id: "floor", label: "Floor mopped, drain clear?" },
      ]
    ),
    qaSection(
      "bedrooms-living",
      "Bedrooms + living — Move-in inspection",
      [
        { id: "wardrobes", label: "Wardrobes / built-ins wiped inside + out?", weight: 2 },
        { id: "skirting", label: "Skirting boards + door frames wiped?" },
        { id: "fans-lights", label: "Ceiling fans + light fittings dust-free?" },
        { id: "floors", label: "Carpets vacuumed (or hard floors mopped) throughout?", weight: 2 },
        { id: "switches", label: "Light switches + handles wiped?" },
      ]
    ),
    qaSection(
      "ready-to-move",
      "Ready-to-move standard",
      [
        { id: "smell", label: "Property smells fresh — no chemical or musty odour?" },
        { id: "fresh", label: "No leftover dirt, hair, dust from previous occupant?", weight: 2 },
        { id: "first-impression", label: "First-impression standard — would you move in tonight?", weight: 2 },
      ],
      { photoMin: 2 }
    ),
  ],
});
