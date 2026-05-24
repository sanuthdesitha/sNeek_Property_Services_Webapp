import { buildQaTemplate, qaSection } from "./_helpers";

/**
 * QA inspection for stand-alone oven cleans.
 * Maps to JobType SPECIAL_CLEAN.
 */
export const qaOvenTemplate = buildQaTemplate({
  name: "Oven Clean — QA Inspection v1",
  serviceType: "SPECIAL_CLEAN",
  sections: [
    qaSection(
      "interior",
      "Oven interior",
      [
        { id: "walls", label: "Oven walls degreased — no carbon buildup?", weight: 3 },
        { id: "racks", label: "Racks scrubbed clean — original finish visible?", weight: 2 },
        { id: "trays", label: "Trays cleaned (or noted as not provided)?" },
        { id: "door-glass", label: "Door glass — inside, outside AND between panes?", weight: 3 },
        { id: "seal", label: "Door seal clean + intact?" },
      ]
    ),
    qaSection(
      "stovetop-rangehood",
      "Stovetop + rangehood (if in scope)",
      [
        { id: "stovetop", label: "Stovetop + burners + knobs cleaned?", weight: 2 },
        { id: "rangehood", label: "Rangehood + filter cleaned or replaced?" },
        { id: "splashback", label: "Splashback degreased near oven?" },
      ]
    ),
    qaSection(
      "finish",
      "Finish + site care",
      [
        { id: "no-streaks", label: "No streaks, residue or chemical smell remaining?", weight: 2 },
        { id: "surroundings", label: "Surrounding cabinets / benchtops protected — no chemical damage?", weight: 2 },
        { id: "test", label: "Oven test-run to clear residue smell?" },
        { id: "wow", label: "Visible 'looks new' result — would the client wow?", weight: 2 },
      ],
      { photoMin: 2, description: "Before + after photos strongly preferred." }
    ),
  ],
});
