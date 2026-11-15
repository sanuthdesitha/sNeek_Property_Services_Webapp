/**
 * Caption, alt text and frame text linter for the social post generator
 * (2026-11-17). Plain module. Whatever wrote the text (a template, AI, an
 * agent or a person), it must never name the property's street address,
 * street number, unit, postcode, the client or the cleaners, and names the
 * suburb only when the owner's permission allows it. The server runs this on
 * every save that affects a network caption and again at the moment of
 * posting; a problem blocks posting, it is never silently rewritten.
 */

export type ForbiddenFacts = {
  address: string;
  postcode: string | null;
  clientName: string | null;
  /** Set only when the permission does NOT allow naming the suburb. */
  suburb: string | null;
  cleanerNames: string[];
};

const STREET_TYPES = "st|street|rd|road|ave|avenue|pde|parade|cres|crescent|dr|drive|ln|lane|pl|place|hwy|highway|tce|terrace|way|blvd|boulevard|ct|court|cl|close|cct|circuit|gr|grove|esp|esplanade";
const STREET_PATTERN = new RegExp(`\\b\\d+[a-z]?\\s+(?:[A-Za-z']+\\s+){1,3}(?:${STREET_TYPES})\\b`, "i");
const UNIT_PATTERN = /\b(?:unit|apt|apartment|flat|suite|level|lvl|shop)\s*#?\s*\d+[a-z]?\b/i;
const SLASH_NUMBER = /(?<![\d,.])\b\d{1,4}[a-z]?\s*\/\s*\d{1,5}[a-z]?\b(?![\d,])/i;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWords(text: string, phrase: string | null | undefined): boolean {
  const value = phrase?.trim();
  if (!value || value.length < 3) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(value)}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
}

/** The street part of an address ("18 Campbell Parade, Bondi" → "Campbell Parade"). */
function streetName(address: string): string | null {
  const first = address.split(",")[0]?.trim() ?? "";
  const withoutNumber = first.replace(/^(?:(?:unit|apt|apartment|flat|suite|level)\s*)?[\d/\-\s]+[a-z]?\s+/i, "").trim();
  return withoutNumber.length >= 5 ? withoutNumber : null;
}

/** Problems in words; an empty list means the text may be used. */
export function lintSocialText(text: string, facts: ForbiddenFacts, where = "The caption"): string[] {
  const problems: string[] = [];
  if (!text.trim()) return problems;
  const street = streetName(facts.address);
  if (containsWords(text, facts.address.split(",")[0]) || (street && containsWords(text, street))) problems.push(`${where} names the property's street. Remove it.`);
  if (STREET_PATTERN.test(text)) problems.push(`${where} looks like it contains a street address. Remove it.`);
  const withoutAllHours = text.replace(/\b24\s*\/\s*7\b/g, "");
  if (UNIT_PATTERN.test(text) || SLASH_NUMBER.test(withoutAllHours)) problems.push(`${where} looks like it contains a unit or street number. Remove it.`);
  if (facts.postcode && new RegExp(`\\b${escapeRegex(facts.postcode)}\\b`).test(text)) problems.push(`${where} contains the property's postcode. Remove it.`);
  if (containsWords(text, facts.clientName)) problems.push(`${where} names the client. Remove it.`);
  for (const name of facts.cleanerNames) {
    if (containsWords(text, name)) {
      problems.push(`${where} names a cleaner. Remove it.`);
      break;
    }
  }
  if (containsWords(text, facts.suburb)) problems.push(`${where} names the suburb, which the owner's permission does not allow. Remove it.`);
  return Array.from(new Set(problems));
}

/** Every photo's forbidden facts merged (a post may mix properties). */
export function mergeForbidden(list: readonly ForbiddenFacts[]): ForbiddenFacts[] {
  return list.filter((facts, index) => list.findIndex((other) => other.address === facts.address && other.clientName === facts.clientName) === index);
}

export function lintAgainstAll(text: string, list: readonly ForbiddenFacts[], where?: string): string[] {
  return Array.from(new Set(list.flatMap((facts) => lintSocialText(text, facts, where))));
}
