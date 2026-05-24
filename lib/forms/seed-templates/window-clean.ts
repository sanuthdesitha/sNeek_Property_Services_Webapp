import type { FormKind, JobType } from "@prisma/client";
import type { FormSchema } from "../types";

export const windowCleanTemplate: {
  name: string;
  kind: FormKind;
  serviceType: JobType;
  version: number;
  schema: FormSchema;
} = {
  name: "Window Clean v1",
  kind: "WINDOW",
  serviceType: "WINDOW_CLEAN",
  version: 1,
  schema: {
    sections: [
      {
        id: "pre-clean",
        title: "Pre-clean assessment",
        fields: [
          { id: "window-count", type: "number", label: "Total window count (approx)" },
          { id: "ladder-needed", type: "checkbox", label: "Ladder needed for any window" },
          { id: "exterior-accessible", type: "select", label: "Exterior access", options: ["All accessible", "Some accessible", "Interior only"], required: true },
          { id: "pre-photos", type: "photo", label: "Before photos (representative)", required: true, minPhotos: 2 },
        ],
      },
      {
        id: "interior",
        title: "Interior windows",
        fields: [
          { id: "int-glass", type: "checkbox", label: "Glass cleaned (streak-free)", required: true, scoring: { weight: 3, max: 1 } },
          { id: "int-frames", type: "checkbox", label: "Frames wiped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "int-sills", type: "checkbox", label: "Sills wiped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "int-spot-check", type: "checkbox", label: "Spot-check from multiple angles for streaks", required: true },
        ],
      },
      {
        id: "exterior",
        title: "Exterior windows",
        fields: [
          { id: "ext-glass", type: "checkbox", label: "Exterior glass cleaned (accessible)", required: true, scoring: { weight: 3, max: 1 } },
          { id: "ext-frames", type: "checkbox", label: "Exterior frames wiped", required: true },
          { id: "ext-sills", type: "checkbox", label: "Exterior sills wiped", required: true },
          { id: "ext-unreachable-noted", type: "longtext", label: "Note any windows that could not be reached" },
        ],
      },
      {
        id: "tracks",
        title: "Tracks",
        fields: [
          { id: "trk-vacuum", type: "checkbox", label: "Tracks vacuumed", required: true, scoring: { weight: 2, max: 1 } },
          { id: "trk-wipe", type: "checkbox", label: "Tracks wiped clean", required: true, scoring: { weight: 2, max: 1 } },
        ],
      },
      {
        id: "screens",
        title: "Flyscreens",
        fields: [
          { id: "scr-removable", type: "checkbox", label: "Removable screens taken off + rinsed" },
          { id: "scr-vacuum", type: "checkbox", label: "Screens vacuumed", required: true },
          { id: "scr-replaced", type: "checkbox", label: "Screens replaced + secure" },
        ],
      },
      {
        id: "photos",
        title: "Final photos",
        fields: [
          { id: "after-photos", type: "photo", label: "Photo each side after cleaning", required: true, minPhotos: 3, scoring: { weight: 2, max: 1 } },
          { id: "signature", type: "signature", label: "Cleaner signature", required: true },
        ],
      },
    ],
  },
};
