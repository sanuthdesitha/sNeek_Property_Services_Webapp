import type { FormKind, JobType } from "@prisma/client";
import type { FormSchema } from "../types";

export const ovenCleanTemplate: {
  name: string;
  kind: FormKind;
  serviceType: JobType;
  version: number;
  schema: FormSchema;
} = {
  name: "Oven Clean v1",
  kind: "OVEN",
  serviceType: "SPECIAL_CLEAN",
  version: 1,
  schema: {
    sections: [
      {
        id: "assessment",
        title: "Pre-clean assessment",
        fields: [
          { id: "oven-model", type: "text", label: "Oven make / model" },
          { id: "oven-type", type: "select", label: "Oven type", options: ["Single", "Double", "Combi (steam)", "Pyrolytic", "Wall oven"], required: true },
          { id: "condition-rating", type: "rating", label: "Initial condition (1=clean, 5=heavy buildup)", required: true },
          { id: "before-photo-interior", type: "photo", label: "Before photo — interior", required: true, minPhotos: 1, scoring: { weight: 2, max: 1 } },
          { id: "before-photo-exterior", type: "photo", label: "Before photo — exterior", required: true, minPhotos: 1 },
          { id: "pyrolytic-flag", type: "checkbox", label: "Pyrolytic warning — use manufacturer-approved method", conditional: { fieldId: "oven-type", equals: "Pyrolytic" } },
        ],
      },
      {
        id: "removable-parts",
        title: "Removable parts",
        fields: [
          { id: "rp-racks-out", type: "checkbox", label: "Racks removed + soaked", required: true, scoring: { weight: 2, max: 1 } },
          { id: "rp-trays-out", type: "checkbox", label: "Trays removed + soaked", required: true, scoring: { weight: 2, max: 1 } },
          { id: "rp-knobs-out", type: "checkbox", label: "Knobs removed + soaked (if removable)" },
          { id: "rp-side-rails", type: "checkbox", label: "Side rails removed (if applicable)" },
          { id: "soak-time", type: "number", label: "Soak time (minutes)", required: true },
        ],
      },
      {
        id: "interior",
        title: "Interior degrease + scrub",
        fields: [
          { id: "in-walls", type: "checkbox", label: "Walls degreased + scrubbed", required: true, scoring: { weight: 3, max: 1 } },
          { id: "in-base", type: "checkbox", label: "Base degreased + scrubbed", required: true, scoring: { weight: 3, max: 1 } },
          { id: "in-roof", type: "checkbox", label: "Roof / element area cleaned (avoid element)", required: true, scoring: { weight: 2, max: 1 } },
          { id: "in-fan-cover", type: "checkbox", label: "Fan cover cleaned (if accessible)" },
          { id: "in-rinsed", type: "checkbox", label: "Interior thoroughly rinsed (no chemical residue)", required: true, scoring: { weight: 3, max: 1 } },
          { id: "in-dried", type: "checkbox", label: "Interior dried", required: true },
        ],
      },
      {
        id: "door-glass",
        title: "Door + glass",
        fields: [
          { id: "dg-outer-glass", type: "checkbox", label: "Outer glass cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "dg-inner-glass", type: "checkbox", label: "Inner glass cleaned (between panes if accessible)", required: true, scoring: { weight: 3, max: 1 } },
          { id: "dg-seal", type: "checkbox", label: "Door seal wiped (gently — do not remove)", required: true },
          { id: "dg-handle", type: "checkbox", label: "Handle polished" },
        ],
      },
      {
        id: "stovetop",
        title: "Hob / stovetop (if included)",
        fields: [
          { id: "st-included", type: "checkbox", label: "Hob included in scope" },
          { id: "st-burners", type: "checkbox", label: "Burners removed + cleaned", conditional: { fieldId: "st-included", equals: true }, scoring: { weight: 2, max: 1 } },
          { id: "st-surface", type: "checkbox", label: "Hob surface cleaned", conditional: { fieldId: "st-included", equals: true }, scoring: { weight: 2, max: 1 } },
          { id: "st-knobs", type: "checkbox", label: "Knobs cleaned", conditional: { fieldId: "st-included", equals: true } },
        ],
      },
      {
        id: "reassembly",
        title: "Reassembly + check",
        fields: [
          { id: "ra-parts-back", type: "checkbox", label: "All parts replaced correctly", required: true, scoring: { weight: 3, max: 1 } },
          { id: "ra-knobs-aligned", type: "checkbox", label: "Knobs aligned to correct positions", required: true },
          { id: "ra-after-photo-interior", type: "photo", label: "After photo — interior", required: true, minPhotos: 1, scoring: { weight: 3, max: 1 } },
          { id: "ra-after-photo-exterior", type: "photo", label: "After photo — exterior", required: true, minPhotos: 1 },
        ],
      },
      {
        id: "function-check",
        title: "Function check",
        fields: [
          { id: "fc-power-test", type: "checkbox", label: "Powered on briefly — fan + light work", required: true, scoring: { weight: 2, max: 1 } },
          { id: "fc-no-smoke", type: "checkbox", label: "No smoke / chemical smell on heat-up", required: true, scoring: { weight: 3, max: 1 } },
          { id: "fc-client-shown", type: "checkbox", label: "Client shown finished oven (if present)" },
          { id: "fc-signature", type: "signature", label: "Cleaner signature", required: true },
          { id: "fc-notes", type: "longtext", label: "Notes / recommendations" },
        ],
      },
    ],
  },
};
