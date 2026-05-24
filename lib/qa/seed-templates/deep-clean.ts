import { buildQaTemplate, qaSection } from "./_helpers";

/**
 * QA inspection for deep cleans.
 * Focus: areas/items beyond a regular clean — appliances, vents, behind/under.
 */
export const qaDeepCleanTemplate = buildQaTemplate({
  name: "Deep Clean — QA Inspection v1",
  serviceType: "DEEP_CLEAN",
  sections: [
    qaSection(
      "kitchen-deep",
      "Kitchen — Deep clean items",
      [
        { id: "oven", label: "Oven interior degreased — racks + walls + door glass?", weight: 3 },
        { id: "rangehood", label: "Rangehood + filter cleaned?", weight: 2 },
        { id: "fridge", label: "Fridge cleaned (if requested) — shelves, drawers, seals?", weight: 2 },
        { id: "behind", label: "Behind / under appliances cleaned where accessible?" },
        { id: "splashback", label: "Splashback degreased, no buildup?" },
      ]
    ),
    qaSection(
      "bathroom-deep",
      "Bathrooms — Deep clean items",
      [
        { id: "grout", label: "Tile + grout scrubbed, mould treated?", weight: 3 },
        { id: "shower-screen", label: "Shower screen — calcium / soap scum removed?", weight: 2 },
        { id: "exhaust", label: "Exhaust fan dust removed?" },
        { id: "behind-toilet", label: "Behind + around toilet cleaned?" },
        { id: "drains", label: "Drains cleared, no smell?" },
      ]
    ),
    qaSection(
      "living-bedroom-deep",
      "Living + bedrooms — Deep clean items",
      [
        { id: "skirting-fans", label: "Skirting boards + ceiling fans dust-free?", weight: 2 },
        { id: "lights", label: "Light fittings + lamp shades dusted?" },
        { id: "under-furniture", label: "Under + behind furniture vacuumed where movable?" },
        { id: "vents", label: "AC vents / returns dust-free?" },
        { id: "switches", label: "Light switches + power points wiped?" },
      ]
    ),
    qaSection(
      "windows-glass",
      "Windows + glass",
      [
        { id: "panes", label: "Window panes streak-free?", weight: 2 },
        { id: "tracks", label: "Tracks vacuumed + wiped?" },
        { id: "frames", label: "Window frames + sills wiped?" },
      ]
    ),
    qaSection(
      "presentation",
      "Overall presentation",
      [
        { id: "smell", label: "Property smells fresh?", weight: 2 },
        { id: "wow", label: "Visible 'wow' difference vs starting condition?", weight: 2 },
        { id: "no-streaks", label: "No streaks, residue or missed spots on inspection?" },
      ],
      { photoMin: 2 }
    ),
  ],
});
