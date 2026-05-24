import { buildQaTemplate, qaSection } from "./_helpers";

/**
 * QA inspection for post-construction / builder cleans.
 * Focus: dust everywhere, sticker / label / debris removal, fine finish.
 */
export const qaPostConstructionTemplate = buildQaTemplate({
  name: "Post-Construction — QA Inspection v1",
  serviceType: "POST_CONSTRUCTION",
  sections: [
    qaSection(
      "debris-removal",
      "Debris + sticker removal",
      [
        { id: "stickers", label: "All manufacturer stickers / labels removed (appliances, windows, fixtures)?", weight: 3 },
        { id: "paint", label: "Paint splatter / overspray removed from glass, tiles, fixtures?", weight: 2 },
        { id: "silicone", label: "Excess silicone / sealant scraped from surfaces?", weight: 2 },
        { id: "rubbish", label: "Construction debris + offcuts removed?" },
      ],
      { description: "These are the items most often missed on builder cleans." }
    ),
    qaSection(
      "dust-control",
      "Dust removal (top to bottom)",
      [
        { id: "high-dust", label: "Ceiling, fans, lights, beams, top of cabinets dusted?", weight: 2 },
        { id: "vents-tracks", label: "AC vents + window tracks vacuumed?", weight: 2 },
        { id: "skirting-frames", label: "Skirting, door frames, architraves wiped?", weight: 2 },
        { id: "fixtures", label: "All fixtures / hardware wiped (handles, hinges, switches)?" },
        { id: "soft-surfaces", label: "Any soft surfaces (curtains, blinds) vacuumed?" },
      ]
    ),
    qaSection(
      "kitchen-build",
      "Kitchen — post-construction items",
      [
        { id: "cabinets", label: "Inside ALL cabinets + drawers vacuumed + wiped?", weight: 2 },
        { id: "appliances", label: "Appliances cleaned, protective film removed?", weight: 2 },
        { id: "splashback", label: "Splashback + benchtops residue-free?" },
        { id: "sink", label: "Sink polished, plug + drain clear of debris?" },
      ]
    ),
    qaSection(
      "bathrooms-build",
      "Bathrooms — post-construction items",
      [
        { id: "grout-residue", label: "Grout residue removed from tiles?", weight: 2 },
        { id: "fixtures", label: "All fixtures clean, no plumber's putty / sticker glue?", weight: 2 },
        { id: "drains", label: "Drains clear of construction debris?" },
        { id: "screen", label: "Shower screen + mirror crystal clear?" },
      ]
    ),
    qaSection(
      "floors-windows",
      "Floors + windows — handover ready",
      [
        { id: "floors", label: "Floors vacuumed + mopped / polished, no dust trail?", weight: 2 },
        { id: "windows", label: "Windows streak-free inside + tracks clean?", weight: 2 },
        { id: "handover", label: "Property genuinely 'handover-ready' — would the builder be proud?", weight: 2 },
      ],
      { photoMin: 2 }
    ),
  ],
});
