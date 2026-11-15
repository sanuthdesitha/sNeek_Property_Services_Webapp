/**
 * Marketing permission rules (social post generator, 2026-11-17). Plain
 * module: the portal, the office dialog and the server share them.
 *
 * Missing means no; "not asked" never counts as yes. Every change is a new
 * append-only row (who, when, how, wording version); an old yes is never
 * edited, only ended.
 */
import { z } from "zod";

export const CONSENT_METHODS = ["PORTAL", "SIGNED_FORM", "EMAIL", "PHONE"] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export const CONSENT_METHOD_LABEL: Readonly<Record<ConsentMethod, string>> = {
  PORTAL: "Client portal tick",
  SIGNED_FORM: "Signed form",
  EMAIL: "Email",
  PHONE: "Phone call",
};

/** The office may record these; the portal tick is the client's own. */
export const OFFICE_CONSENT_METHODS: readonly ConsentMethod[] = ["SIGNED_FORM", "EMAIL", "PHONE"];

/** Saved with every row so a later change of wording is visible in the history. */
export const CONSENT_WORDING_VERSION = "marketing-photos-v1";

export const CONSENT_PORTAL_WORDING = {
  title: "Photos of your property in our marketing",
  body: "We'd like to share a few photos of how we leave your place on our social pages. We never show the address, street number, guests, belongings, mail or screens, and we crop off the time and address stamp.",
  yes: "Yes, sNeek may use photos of my properties",
  suburb: "You may name the suburb (for example \"Bondi\")",
  before: "You may use \"before\" photos",
  revokeNote: "Turning it off stops new posts straight away and asks us to remove existing ones.",
} as const;

export const officeConsentInput = z.object({
  clientId: z.string().min(1).max(128),
  propertyIds: z.array(z.string().min(1).max(128)).min(1).max(200),
  method: z.enum(["SIGNED_FORM", "EMAIL", "PHONE"]),
  givenByName: z.string().trim().min(1).max(160),
  allowSuburb: z.boolean(),
  allowBefore: z.boolean(),
  evidenceS3Key: z.string().trim().max(500).optional().nullable(),
  evidenceNote: z.string().trim().max(2000).optional().nullable(),
}).strict();

export type OfficeConsentInput = z.infer<typeof officeConsentInput>;

export const portalConsentInput = z.object({
  allow: z.boolean(),
  propertyIds: z.array(z.string().min(1).max(128)).max(200).optional(),
  allowSuburb: z.boolean().optional(),
  allowBefore: z.boolean().optional(),
}).strict();

export type PortalConsentInput = z.infer<typeof portalConsentInput>;

/** Null when the office record is complete; otherwise what is missing, in words. */
export function officeConsentProblem(input: OfficeConsentInput): string | null {
  if ((input.method === "EMAIL" || input.method === "SIGNED_FORM") && !input.evidenceS3Key) {
    return "Attach the email or signed form: it is required for those two ways.";
  }
  if (input.method === "PHONE" && !input.evidenceNote) {
    return "Add a note of the call (what was agreed and with whom).";
  }
  return null;
}

/** A stored row as the screens show it. */
export type ConsentView = {
  id: string;
  clientId: string;
  clientName: string;
  properties: Array<{ id: string; name: string }>;
  allowSuburb: boolean;
  allowBefore: boolean;
  method: ConsentMethod;
  givenByName: string;
  recordedByName: string | null;
  hasEvidence: boolean;
  evidenceNote: string | null;
  wordingVersion: string;
  givenAt: string;
  endedAt: string | null;
  endedVia: string | null;
  endedByName: string | null;
};
