/**
 * The onboarding workspace's eleven sections and the readiness step (board
 * "Property onboarding steps"). Order, names, what each sets up on activation
 * and which ones the client may be asked to fill. Plain module: the screens,
 * the routes and the tests read it.
 */

export const ONBOARDING_SECTION_KEYS = [
  "basics",
  "client",
  "rooms",
  "access",
  "laundry",
  "stock",
  "scope",
  "photos",
  "pricing",
  "calendar",
  "rules",
] as const;

export type OnboardingSectionKey = (typeof ONBOARDING_SECTION_KEYS)[number];
export type OnboardingStepKey = OnboardingSectionKey | "readiness";

export type OnboardingSectionDef = {
  key: OnboardingSectionKey;
  number: number;
  title: string;
  /** Short label for the checklist on a phone ("Next: Laundry"). */
  short: string;
  /** Who fills it: shown under the step title. */
  filledBy: string;
  /** What activation does with it, read from the approval code. */
  setsUp: string[];
  note?: string;
};

export const ONBOARDING_SECTIONS: readonly OnboardingSectionDef[] = [
  {
    key: "basics",
    number: 1,
    title: "Basics and address",
    short: "Basics",
    filledBy: "Office · client can confirm",
    setsUp: [
      "Property name, address and pin (cleaner on-site check, travel distance in cleaner suggestions)",
      "Type and size feed the cleaner and hours estimate; they stay on the survey",
      "Clock-in radius on the property",
    ],
    note: "Type and size are not copied to the property (they were never read there). Nothing is lost: they stay on this onboarding.",
  },
  {
    key: "client",
    number: 2,
    title: "Client and owner",
    short: "Client",
    filledBy: "Office",
    setsUp: [
      "Links the property to an existing client, or creates the new client on activation",
      "The owner or emergency contact goes to the first job's internal notes, as today",
    ],
  },
  {
    key: "rooms",
    number: 3,
    title: "Rooms and beds",
    short: "Rooms",
    filledBy: "Office",
    setsUp: [
      "Bedrooms, bathrooms, balcony and sofa beds on the property (they decide the cleaner's form sections)",
      "Appliances become property features for the checklist",
      "The room list and any old bed text are added to the property notes",
    ],
  },
  {
    key: "access",
    number: 4,
    title: "Access",
    short: "Access",
    filledBy: "Office · client can fill",
    setsUp: [
      "The property's access guide, with photos",
      "Lockbox and alarm codes, stored encrypted",
      "Key location and parking",
    ],
  },
  {
    key: "laundry",
    number: 5,
    title: "Linen and laundry",
    short: "Laundry",
    filledBy: "Office · client can give linen counts",
    setsUp: ["Laundry on or off, partner and detergent", "Spare (buffer) sets and the bag label and colour"],
    note: "The scheduling rules are read only here. Change them in Settings, Scheduling rules.",
  },
  {
    key: "stock",
    number: 6,
    title: "Stock list",
    short: "Stock",
    filledBy: "Office",
    setsUp: ["Stock rows with par and reorder levels, created on activation"],
  },
  {
    key: "scope",
    number: 7,
    title: "Cleaning scope and form",
    short: "Scope",
    filledBy: "Office",
    setsUp: [
      "The property's own cleaner forms for each ticked job type, and its checklist profile",
      "Special requests become checklist tasks (high and urgent ones need a proof photo)",
    ],
    note: "A ticked type that produces no form is warned about on activation, not skipped silently.",
  },
  {
    key: "photos",
    number: 8,
    title: "Photos per room",
    short: "Photos",
    filledBy: "Office · client can fill",
    setsUp: ["Reference positions in the property's setup guide, so the cleaner can match the listing photo"],
  },
  {
    key: "pricing",
    number: 9,
    title: "Pricing and rates",
    short: "Pricing",
    filledBy: "Office only",
    setsUp: ["Client rates per job type on the property", "Cleaner pay per clean on the property"],
  },
  {
    key: "calendar",
    number: 10,
    title: "Calendar links",
    short: "Calendar",
    filledBy: "Office · client can fill",
    setsUp: ["The property's calendar link, switched on after activation", "Check-in and check-out times"],
  },
  {
    key: "rules",
    number: 11,
    title: "House rules and hazards",
    short: "House rules",
    filledBy: "Office · client can fill",
    setsUp: ["Hazards and building rules reach the cleaner's access guide and the property notes"],
  },
];

export function sectionDef(key: OnboardingSectionKey): OnboardingSectionDef {
  return ONBOARDING_SECTIONS.find((section) => section.key === key)!;
}

export function isOnboardingSectionKey(value: unknown): value is OnboardingSectionKey {
  return typeof value === "string" && (ONBOARDING_SECTION_KEYS as readonly string[]).includes(value);
}

export function isOnboardingStepKey(value: unknown): value is OnboardingStepKey {
  return value === "readiness" || isOnboardingSectionKey(value);
}

/** Parts the client may be asked to fill through a link. Pricing, rates, laundry partner and the cleaner form never. */
export const CLIENT_LINK_SECTIONS = ["access", "photos", "rules", "linen", "calendar"] as const;
export type ClientLinkSection = (typeof CLIENT_LINK_SECTIONS)[number];

export const CLIENT_LINK_SECTION_LABELS: Record<ClientLinkSection, string> = {
  access: "Access",
  photos: "Photos per room",
  rules: "House rules and hazards",
  linen: "Linen counts",
  calendar: "Calendar link",
};

/** The workspace section a client part belongs to (for the "C" mark on the checklist). */
export const CLIENT_SECTION_TO_STEP: Record<ClientLinkSection, OnboardingSectionKey> = {
  access: "access",
  photos: "photos",
  rules: "rules",
  linen: "laundry",
  calendar: "calendar",
};

export function isClientLinkSection(value: unknown): value is ClientLinkSection {
  return typeof value === "string" && (CLIENT_LINK_SECTIONS as readonly string[]).includes(value);
}

export const CLIENT_LINK_DEFAULT_DAYS = 7;
export const CLIENT_LINK_MAX_DAYS = 30;

/** Job types offered on the scope step (the JobType enum, in its order). */
export const ONBOARDING_JOB_TYPES = [
  "AIRBNB_TURNOVER",
  "DEEP_CLEAN",
  "END_OF_LEASE",
  "MOVE_IN_CLEAN",
  "GENERAL_CLEAN",
  "POST_CONSTRUCTION",
  "PRESSURE_WASH",
  "WINDOW_CLEAN",
  "LAWN_MOWING",
  "SPECIAL_CLEAN",
  "COMMERCIAL_RECURRING",
  "CARPET_STEAM_CLEAN",
  "MOLD_TREATMENT",
  "UPHOLSTERY_CLEANING",
  "TILE_GROUT_CLEANING",
  "GUTTER_CLEANING",
  "SPRING_CLEANING",
] as const;
