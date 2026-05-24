import { buildQaTemplate, qaSection } from "./_helpers";

/**
 * QA inspection for commercial recurring cleans (office, retail, etc.).
 */
export const qaCommercialTemplate = buildQaTemplate({
  name: "Commercial Recurring Clean — QA Inspection v1",
  serviceType: "COMMERCIAL_RECURRING",
  sections: [
    qaSection(
      "common-areas",
      "Common areas + reception",
      [
        { id: "entry", label: "Entry / reception spotless — first impression strong?", weight: 2 },
        { id: "floors", label: "Floors vacuumed / mopped, no streaks?", weight: 2 },
        { id: "glass", label: "Glass doors + reception surfaces fingerprint-free?" },
        { id: "bins", label: "Bins emptied + relined?" },
      ]
    ),
    qaSection(
      "workspaces",
      "Workspaces + meeting rooms",
      [
        { id: "desks", label: "Desks wiped (where cleared), no dust on monitors / accessories?", weight: 2 },
        { id: "meeting", label: "Meeting rooms reset, whiteboards clean (if scoped)?" },
        { id: "switches", label: "Light switches + door handles sanitized?" },
        { id: "common-surf", label: "Common surfaces (printers, fridges, microwaves) wiped?" },
      ]
    ),
    qaSection(
      "kitchenettes",
      "Kitchenettes + breakout",
      [
        { id: "benchtops", label: "Benchtops + splashback wiped?", weight: 2 },
        { id: "sink", label: "Sink + tap polished, dishes done / dishwasher run?" },
        { id: "appliances", label: "Microwave + fridge exterior wiped, no spills?" },
        { id: "bins", label: "Bins emptied + relined?" },
      ]
    ),
    qaSection(
      "restrooms",
      "Restrooms",
      [
        { id: "toilets", label: "All toilets / urinals sanitized?", weight: 3 },
        { id: "basins", label: "Basins + mirrors + taps polished?", weight: 2 },
        { id: "stock", label: "Soap + paper towels + toilet paper restocked?", weight: 2 },
        { id: "floors", label: "Floors mopped, no smell?" },
      ]
    ),
    qaSection(
      "compliance",
      "Compliance + handover",
      [
        { id: "checklist", label: "Site-specific checklist signed off?", weight: 2 },
        { id: "lockup", label: "Site secured per instructions (alarm, lights, doors)?", weight: 2 },
        { id: "incidents", label: "Any incidents / damage reported through correct channel?" },
      ]
    ),
  ],
});
