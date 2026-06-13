import type { FormKind, JobType } from "@prisma/client";
import type { FormSchema } from "../types";

// Post-checkout inspection focused on catching guest damage, missing items and
// excessive mess for deposit / claim evidence — heavy on photos + ratings.
export const checkoutInspectionTemplate: {
  name: string;
  kind: FormKind;
  serviceType: JobType;
  version: number;
  schema: FormSchema;
} = {
  name: "Check-out Inspection + Damage Sweep v1",
  kind: "END_OF_LEASE",
  serviceType: "END_OF_LEASE",
  version: 2,
  schema: {
    theme: {
      accentColor: "#dc2626",
      headerColor: "#7f1d1d",
      showDividers: true,
    },
    sections: [
      {
        id: "ci-overview",
        title: "Overall condition",
        description: "Document the property as you first find it.",
        fields: [
          { id: "ci-overall-rating", type: "rating", label: "Overall cleanliness on arrival", max: 5, required: true },
          { id: "ci-arrival-photos", type: "photo", label: "Arrival condition photos", required: true, minPhotos: 3 },
          { id: "ci-excessive-mess", type: "yesno", label: "Excessive mess beyond normal turnover?", required: true, includeNa: false, detailsWhenNo: false },
          { id: "ci-mess-photos", type: "photo", label: "Evidence of excessive mess", minPhotos: 0, conditional: { fieldId: "ci-excessive-mess", operator: "equals", value: true } },
        ],
      },
      {
        id: "ci-damage",
        title: "Damage sweep",
        fields: [
          {
            id: "ci-damage-found",
            type: "yesno",
            label: "Any damage found?",
            required: true,
            severity: "high",
            includeNa: false,
            references: [
              {
                kind: "image",
                url: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800",
                caption: "Photograph damage with a reference object for scale",
              },
            ],
          },
          { id: "ci-damage-location", type: "text", label: "Where is the damage?", placeholder: "Room + surface", conditional: { fieldId: "ci-damage-found", operator: "equals", value: true } },
          { id: "ci-damage-desc", type: "longtext", label: "Describe the damage", conditional: { fieldId: "ci-damage-found", operator: "equals", value: true } },
          { id: "ci-damage-photos", type: "photo", label: "Damage photos (close + wide)", minPhotos: 2, conditional: { fieldId: "ci-damage-found", operator: "equals", value: true } },
          { id: "ci-damage-gps", type: "location", label: "Tag damage location (GPS)", conditional: { fieldId: "ci-damage-found", operator: "equals", value: true } },
        ],
      },
      {
        id: "ci-missing",
        title: "Missing / moved items",
        fields: [
          { id: "ci-missing-found", type: "yesno", label: "Any items missing or relocated?", includeNa: false, detailsWhenNo: false },
          { id: "ci-missing-list", type: "longtext", label: "List missing / moved items", conditional: { fieldId: "ci-missing-found", operator: "equals", value: true } },
          { id: "ci-missing-photos", type: "photo", label: "Photos of affected areas", minPhotos: 0, conditional: { fieldId: "ci-missing-found", operator: "equals", value: true } },
        ],
      },
      {
        id: "ci-smoke-pet",
        title: "Policy breaches",
        fields: [
          { id: "ci-smoking", type: "checkbox", label: "Smoking evidence / smell", severity: "high" },
          { id: "ci-pets", type: "checkbox", label: "Unauthorised pet evidence", severity: "medium" },
          { id: "ci-extra-guests", type: "checkbox", label: "Signs of extra / party guests" },
          { id: "ci-policy-photos", type: "photo", label: "Evidence photos", minPhotos: 0 },
        ],
      },
      {
        id: "ci-signoff",
        title: "Inspection sign-off",
        fields: [
          { id: "ci-claim-needed", type: "yesno", label: "Recommend a claim / host follow-up?", includeNa: false },
          { id: "ci-summary", type: "longtext", label: "Inspection summary", required: true },
          { id: "ci-signature", type: "signature", label: "Inspector signature", required: true },
        ],
      },
    ],
  },
};
