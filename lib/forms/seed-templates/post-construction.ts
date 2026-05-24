import type { FormKind, JobType } from "@prisma/client";
import type { FormSchema } from "../types";

// Builder's / post-construction clean. Heavy on dust, debris, hazards.
export const postConstructionTemplate: {
  name: string;
  kind: FormKind;
  serviceType: JobType;
  version: number;
  schema: FormSchema;
} = {
  name: "Post-Construction Clean v1",
  kind: "POST_CONSTRUCTION",
  serviceType: "POST_CONSTRUCTION",
  version: 1,
  schema: {
    sections: [
      {
        id: "hazards",
        title: "Site safety",
        description: "Confirm site is safe before commencing.",
        fields: [
          { id: "site-safe", type: "checkbox", label: "Site walked + confirmed safe", required: true, scoring: { weight: 3, max: 1 } },
          { id: "ppe-noted", type: "multiselect", label: "PPE worn", options: ["Mask (P2/N95)", "Safety glasses", "Gloves", "Steel-cap boots", "Hi-vis"], required: true },
          { id: "hazards-photos", type: "photo", label: "Photo any hazards / pre-existing damage", minPhotos: 0 },
          { id: "power-water-confirmed", type: "checkbox", label: "Power + water available", required: true },
        ],
      },
      {
        id: "debris",
        title: "Debris removal",
        fields: [
          { id: "deb-large", type: "checkbox", label: "Large debris bagged + disposed", required: true, scoring: { weight: 3, max: 1 } },
          { id: "deb-small", type: "checkbox", label: "Small debris swept + collected", required: true, scoring: { weight: 2, max: 1 } },
          { id: "deb-photos", type: "photo", label: "Photo debris-cleared site", required: true, minPhotos: 2 },
        ],
      },
      {
        id: "dust",
        title: "Dust removal",
        description: "HEPA vacuum recommended for all surfaces.",
        fields: [
          { id: "dust-walls", type: "checkbox", label: "Walls dusted (top to bottom)", required: true, scoring: { weight: 3, max: 1 } },
          { id: "dust-ceilings", type: "checkbox", label: "Ceilings dusted", required: true, scoring: { weight: 2, max: 1 } },
          { id: "dust-fans", type: "checkbox", label: "Ceiling fans + light fittings dusted", required: true, scoring: { weight: 2, max: 1 } },
          { id: "dust-vents", type: "checkbox", label: "A/C vents + filters cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "dust-skirting", type: "checkbox", label: "Skirting boards + cornices wiped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "dust-switches", type: "checkbox", label: "Switches + power points wiped", required: true },
          { id: "dust-doors", type: "checkbox", label: "Doors + frames + handles wiped", required: true },
        ],
      },
      {
        id: "paint",
        title: "Paint + adhesive splatter",
        fields: [
          { id: "paint-windows", type: "checkbox", label: "Paint scraped from windows + frames", required: true, scoring: { weight: 2, max: 1 } },
          { id: "paint-floors", type: "checkbox", label: "Paint / adhesive removed from floors", required: true, scoring: { weight: 2, max: 1 } },
          { id: "paint-fixtures", type: "checkbox", label: "Paint removed from fixtures + tiles", required: true, scoring: { weight: 2, max: 1 } },
          { id: "paint-stickers", type: "checkbox", label: "Stickers / labels removed from appliances + windows", required: true },
        ],
      },
      {
        id: "windows",
        title: "Window clean",
        fields: [
          { id: "win-interior", type: "checkbox", label: "Interior windows cleaned + polished", required: true, scoring: { weight: 2, max: 1 } },
          { id: "win-exterior", type: "checkbox", label: "Exterior windows cleaned (accessible)", required: true, scoring: { weight: 2, max: 1 } },
          { id: "win-tracks", type: "checkbox", label: "Window tracks vacuumed + wiped", required: true },
          { id: "win-frames", type: "checkbox", label: "Frames + sills cleaned" },
        ],
      },
      {
        id: "floors",
        title: "Floor clean",
        fields: [
          { id: "flo-film-removed", type: "checkbox", label: "Protective film removed (if present)" },
          { id: "flo-vacuum-pass-1", type: "checkbox", label: "First vacuum pass complete", required: true, scoring: { weight: 2, max: 1 } },
          { id: "flo-mop-pass", type: "checkbox", label: "Mop pass complete", required: true, scoring: { weight: 2, max: 1 } },
          { id: "flo-vacuum-pass-2", type: "checkbox", label: "Second vacuum pass (final dust)", required: true, scoring: { weight: 2, max: 1 } },
        ],
      },
      {
        id: "fixtures",
        title: "Fixtures detail",
        fields: [
          { id: "fix-taps", type: "checkbox", label: "Taps polished", required: true },
          { id: "fix-handles", type: "checkbox", label: "Door + cabinet handles polished", required: true },
          { id: "fix-switchplates", type: "checkbox", label: "Switch plates wiped" },
          { id: "fix-mirrors", type: "checkbox", label: "Mirrors polished" },
        ],
      },
      {
        id: "photos",
        title: "Photos — extensive",
        fields: [
          { id: "before-photos", type: "photo", label: "Before photos (each room)", required: true, minPhotos: 4, scoring: { weight: 2, max: 1 } },
          { id: "after-photos", type: "photo", label: "After photos (each room)", required: true, minPhotos: 4, scoring: { weight: 3, max: 1 } },
          { id: "signature", type: "signature", label: "Cleaner / site supervisor signature", required: true },
        ],
      },
    ],
  },
};
