import type { FormKind, JobType } from "@prisma/client";
import type { FormSchema } from "../types";

export const moveInCleanTemplate: {
  name: string;
  kind: FormKind;
  serviceType: JobType;
  version: number;
  schema: FormSchema;
} = {
  name: "Move-In Clean v1",
  kind: "MOVE_IN",
  serviceType: "GENERAL_CLEAN",
  version: 1,
  schema: {
    sections: [
      {
        id: "walkthrough",
        title: "Walkthrough",
        description: "Confirm property is empty + note any pre-existing damage.",
        fields: [
          { id: "property-empty", type: "checkbox", label: "Property confirmed empty (no prior tenant items)", required: true, scoring: { weight: 2, max: 1 } },
          { id: "pre-damage-noted", type: "longtext", label: "Pre-existing damage noted" },
          { id: "pre-damage-photos", type: "photo", label: "Pre-existing damage photos (CYA)", minPhotos: 0 },
          { id: "smell-check", type: "checkbox", label: "Smell check passed (no lingering odours)" },
        ],
      },
      {
        id: "all-rooms",
        title: "All rooms",
        fields: [
          { id: "ar-surfaces", type: "checkbox", label: "All visible surfaces wiped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "ar-floors", type: "checkbox", label: "All floors vacuumed + mopped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "ar-switches", type: "checkbox", label: "Light switches + power points wiped", required: true },
          { id: "ar-doors", type: "checkbox", label: "Doors + frames + handles wiped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "ar-skirting", type: "checkbox", label: "Skirting boards wiped", required: true },
          { id: "ar-light-fittings", type: "checkbox", label: "Light fittings dusted" },
          { id: "ar-fans", type: "checkbox", label: "Ceiling fans dusted" },
        ],
      },
      {
        id: "bathrooms",
        title: "Bathrooms — ready for occupancy",
        fields: [
          { id: "ba-toilet-sanitized", type: "checkbox", label: "Toilet fully sanitized", required: true, scoring: { weight: 3, max: 1 } },
          { id: "ba-shower-cleaned", type: "checkbox", label: "Shower + screen cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "ba-basin", type: "checkbox", label: "Basin + tap polished", required: true },
          { id: "ba-floor-sanitized", type: "checkbox", label: "Floor mopped + sanitized", required: true, scoring: { weight: 2, max: 1 } },
          { id: "ba-mirror", type: "checkbox", label: "Mirror polished", required: true },
          { id: "ba-exhaust", type: "checkbox", label: "Exhaust fan dusted" },
          { id: "ba-photos", type: "photo", label: "Photo each bathroom", required: true, minPhotos: 1 },
        ],
      },
      {
        id: "kitchen",
        title: "Kitchen",
        fields: [
          { id: "kt-bench", type: "checkbox", label: "Benchtops cleaned + polished", required: true, scoring: { weight: 2, max: 1 } },
          { id: "kt-cabinets-int", type: "checkbox", label: "Cabinets interior wiped", required: true, scoring: { weight: 2, max: 1 } },
          { id: "kt-cabinets-ext", type: "checkbox", label: "Cabinets exterior wiped", required: true },
          { id: "kt-oven", type: "checkbox", label: "Oven cleaned (if not warranty-sealed)", scoring: { weight: 2, max: 1 } },
          { id: "kt-fridge-interior", type: "checkbox", label: "Fridge interior wiped (if present)" },
          { id: "kt-sink", type: "checkbox", label: "Sink + taps polished", required: true },
          { id: "kt-photos", type: "photo", label: "Photo kitchen", required: true, minPhotos: 1 },
        ],
      },
      {
        id: "windows",
        title: "Windows",
        fields: [
          { id: "wn-interior", type: "checkbox", label: "All interior windows cleaned", required: true, scoring: { weight: 2, max: 1 } },
          { id: "wn-tracks", type: "checkbox", label: "Tracks vacuumed + wiped", required: true },
          { id: "wn-sills", type: "checkbox", label: "Sills wiped", required: true },
        ],
      },
      {
        id: "photos",
        title: "Photos + welcome",
        fields: [
          { id: "every-room", type: "photo", label: "Photo every room — move-in ready", required: true, minPhotos: 5, scoring: { weight: 3, max: 1 } },
          { id: "welcome-touch", type: "checkbox", label: "Welcome touch added (if part of package)" },
          { id: "signature", type: "signature", label: "Cleaner signature", required: true },
        ],
      },
    ],
  },
};
