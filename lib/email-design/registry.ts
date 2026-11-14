/**
 * Every email on the block layout, by key. Plain module.
 */
import { ACCOUNT_DESIGNS } from "./catalog/accounts";
import { OTHER_DESIGNS } from "./catalog/others";
import { TEMPLATE_DESIGNS } from "./catalog/templates";
import { ROUTE_DESIGNS } from "./catalog/routes";
import { LIFECYCLE_DESIGNS } from "./catalog/lifecycle";
import type { EmailDesignDefinition, EmailGroup } from "./types";

export const EMAIL_DESIGNS: readonly EmailDesignDefinition[] = [...ACCOUNT_DESIGNS, ...TEMPLATE_DESIGNS, ...OTHER_DESIGNS, ...ROUTE_DESIGNS, ...LIFECYCLE_DESIGNS];

const BY_KEY = new Map(EMAIL_DESIGNS.map((definition) => [definition.key, definition]));

export function emailDesign(key: string): EmailDesignDefinition | null {
  return BY_KEY.get(key) ?? null;
}

export function designsForType(typeKey: string): EmailDesignDefinition[] {
  return EMAIL_DESIGNS.filter((definition) => definition.typeKey === typeKey);
}

export const EMAIL_GROUP_ORDER: readonly EmailGroup[] = ["accounts", "cleaners", "clients", "laundry", "office", "money", "marketing"];

/**
 * Generic definitions used to put something that is not (yet) a block design
 * onto the base layout: an HTML body from the wording layer or a route, a
 * campaign, a finance-editor email. They carry the footer's why-line only.
 */
export const LEGACY_LAYOUT_DEFINITION: Pick<EmailDesignDefinition, "key" | "variables" | "whyLine" | "preferences" | "security"> = {
  key: "legacy",
  variables: [],
  whyLine: "You got this because you have an account with sNeek or a job, quote or invoice with us.",
  preferences: "none",
  security: false,
};

export const MARKETING_LAYOUT_DEFINITION: Pick<EmailDesignDefinition, "key" | "variables" | "whyLine" | "preferences" | "security"> = {
  key: "campaign",
  variables: [],
  whyLine: "You got this because you're a client of sNeek or asked to hear from us. Unsubscribing stops campaign emails only; job, invoice and account emails continue.",
  preferences: "none",
  security: false,
};
