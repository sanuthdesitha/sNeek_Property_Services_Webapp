import { buildQaTemplate, qaSection } from "./_helpers";

/**
 * QA inspection for window cleaning jobs.
 * Focus: streak-free finish, tracks + frames, safety.
 */
export const qaWindowTemplate = buildQaTemplate({
  name: "Window Clean — QA Inspection v1",
  serviceType: "WINDOW_CLEAN",
  sections: [
    qaSection(
      "external",
      "External windows",
      [
        { id: "streak", label: "All external panes streak-free at angle + direct light?", weight: 3 },
        { id: "frames", label: "External frames + sills wiped?", weight: 2 },
        { id: "edges", label: "Edges + corners squeegeed cleanly, no water marks?", weight: 2 },
        { id: "flyscreens", label: "Flyscreens cleaned or noted as not in scope?" },
      ]
    ),
    qaSection(
      "internal",
      "Internal windows",
      [
        { id: "streak", label: "All internal panes streak-free?", weight: 3 },
        { id: "tracks", label: "Tracks vacuumed + wiped — no debris?", weight: 2 },
        { id: "sills", label: "Sills + frames wiped?" },
        { id: "treatments", label: "Window treatments (blinds, curtains) undamaged?" },
      ]
    ),
    qaSection(
      "safety-finish",
      "Safety + finish",
      [
        { id: "safety", label: "All safety equipment used, no incidents reported?", weight: 2 },
        { id: "drips", label: "No water drips on walls, floors or surfaces?", weight: 2 },
        { id: "presentation", label: "Overall: windows showroom-grade?", weight: 2 },
      ],
      { photoMin: 2 }
    ),
  ],
});
