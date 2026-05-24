import { buildQaTemplate, qaSection } from "./_helpers";

/**
 * QA inspection for carpet steam cleaning jobs.
 */
export const qaCarpetTemplate = buildQaTemplate({
  name: "Carpet Steam Clean — QA Inspection v1",
  serviceType: "CARPET_STEAM_CLEAN",
  sections: [
    qaSection(
      "prep",
      "Pre-clean preparation",
      [
        { id: "vacuumed", label: "Carpet vacuumed thoroughly before steam?", weight: 2 },
        { id: "stains-treated", label: "Stains pre-treated with appropriate product?", weight: 2 },
        { id: "furniture", label: "Furniture moved + protected (or noted)?" },
        { id: "high-traffic", label: "High-traffic areas given extra attention?" },
      ]
    ),
    qaSection(
      "finish",
      "Steam clean finish",
      [
        { id: "stains-removed", label: "Visible stains lifted (or accurately documented as permanent)?", weight: 3 },
        { id: "even", label: "Cleaning even — no missed strips or over-wet patches?", weight: 2 },
        { id: "edges", label: "Edges + corners cleaned, not just open areas?", weight: 2 },
        { id: "smell", label: "Carpet smells fresh — no chemical odour?" },
        { id: "drying", label: "Drying time communicated, fans / airflow set?" },
      ]
    ),
    qaSection(
      "site-care",
      "Site care",
      [
        { id: "skirting", label: "Skirting boards + walls free of splashes?", weight: 2 },
        { id: "furniture-back", label: "Furniture protected (foam blocks, foil tabs) while drying?" },
        { id: "presentation", label: "Carpet visibly cleaner / restored — would the client agree?", weight: 2 },
      ],
      { photoMin: 2, description: "Include before / after shots if available." }
    ),
  ],
});
