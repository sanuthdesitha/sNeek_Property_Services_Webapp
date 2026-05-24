import { buildQaTemplate, qaSection } from "./_helpers";

/**
 * QA inspection for end-of-lease / bond cleans.
 * Higher scrutiny than turnovers — bond return depends on these.
 */
export const qaEndOfLeaseTemplate = buildQaTemplate({
  name: "End of Lease — QA Inspection v1",
  serviceType: "END_OF_LEASE",
  sections: [
    qaSection(
      "bedrooms",
      "Bedrooms / wardrobes — QA Inspection",
      [
        { id: "wardrobes", label: "Wardrobes empty, shelves wiped inside + out?", weight: 2 },
        { id: "skirting", label: "Skirting boards wiped, no dust on top?", weight: 2 },
        { id: "windows-tracks", label: "Window sills + tracks vacuumed and wiped?", weight: 2 },
        { id: "fans-lights", label: "Ceiling fans + light fittings dust-free?" },
        { id: "marks", label: "Walls + doors free of marks, scuffs touched up?" },
      ],
      { description: "Bond inspectors check inside every cupboard — confirm." }
    ),
    qaSection(
      "bathrooms",
      "Bathrooms — Detailed QA",
      [
        { id: "grout", label: "Tile grout cleaned, no mould remaining?", weight: 3 },
        { id: "shower-screen", label: "Shower screen glass crystal clear, no calcium?", weight: 2 },
        { id: "toilet-detail", label: "Toilet — inc. behind, hinges, base, S-bend?", weight: 2 },
        { id: "exhaust", label: "Exhaust fan vent dust-free?" },
        { id: "vanity-inside", label: "Vanity / cabinet inside wiped?" },
        { id: "drain", label: "Drains hair-free, no smell?" },
      ]
    ),
    qaSection(
      "kitchen",
      "Kitchen — Detailed QA",
      [
        { id: "oven", label: "Oven — racks, walls, glass, seal, all degreased?", weight: 3 },
        { id: "rangehood", label: "Rangehood + filter cleaned or replaced?", weight: 2 },
        { id: "cupboards-in", label: "Inside ALL cupboards + drawers wiped?", weight: 2 },
        { id: "fridge-cavity", label: "Fridge cavity wiped, seals clean (if landlord-supplied)?" },
        { id: "splashback", label: "Splashback degreased, tiles + grout clean?" },
        { id: "sink", label: "Sink polished, plug + drain clean?" },
      ]
    ),
    qaSection(
      "windows-glass",
      "Windows + glass — internal",
      [
        { id: "panes", label: "All window panes streak-free inside?", weight: 2 },
        { id: "tracks", label: "Tracks vacuumed + wiped?", weight: 2 },
        { id: "flyscreens", label: "Flyscreens cleaned or noted?" },
        { id: "mirrors-glass", label: "Mirrors + glass surfaces streak-free?" },
      ]
    ),
    qaSection(
      "floors-walls",
      "Floors + walls — full property",
      [
        { id: "carpet", label: "Carpet vacuumed + steam cleaned (or receipt attached)?", weight: 2 },
        { id: "hard-floors", label: "Hard floors mopped, edges + corners clean?", weight: 2 },
        { id: "skirting-all", label: "All skirting boards wiped throughout?" },
        { id: "walls", label: "Walls free of marks (or noted as pre-existing)?" },
      ]
    ),
    qaSection(
      "external",
      "External + exits",
      [
        { id: "balcony", label: "Balcony / patio swept, glass cleaned?" },
        { id: "garage", label: "Garage swept, no cobwebs?" },
        { id: "bins", label: "Bins emptied + rinsed?" },
        { id: "cobwebs", label: "External cobwebs cleared around entries?" },
      ]
    ),
  ],
});
