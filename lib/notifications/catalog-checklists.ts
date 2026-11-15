/** Catalog entries for checklist rollout (2026-11-17). Data only; see catalog.ts. */
import type { NotificationTypeEntry } from "./catalog-types";

export const CHECKLIST_NOTIFICATION_TYPES: NotificationTypeEntry[] = [
  {
    key: "checklist.amenities_link",
    name: "Amenities survey link to the client",
    group: "Clients",
    trigger: "The office presses \"Email it to the client\" in Forms › Checklist blocks › Checklist coverage, after making a property's amenities survey link.",
    audience: "The client's billing email address (the client record), which may have no login.",
    audienceKeys: ["CLIENT"],
    initiator: "OFFICE_MANUAL",
    transports: ["EMAIL"],
    defaultTransports: ["EMAIL"],
    path: "DIRECT",
    switches: [],
    template: { kind: "NONE" },
    preferences: "EMAIL_GATES_ONLY",
    producers: ["lib/checklists/amenities-link-email.ts", "lib/notifications/external-recipient.ts"],
    notes: "Email only, never SMS or push (owner default 2026-11-17). Wording and block design are editable under this type. Sent through the shared external-recipient path (email chokepoint, suppression list, rate limits, one send per key, masked audit). Provider accepted is not delivered. The link it carries is the one the office just made; it expires on its own date.",
  },
];
