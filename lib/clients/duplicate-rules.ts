/**
 * Add client's similar-client notice (board "Add client", owner default
 * 2026-11-16: warn only, never block; agencies share inboxes). PLAIN module.
 */

export type DuplicateCandidate = { name: string; email?: string | null; phone?: string | null };

export type ExistingClientFacts = { id: string; name: string; email: string | null; phone: string | null; isActive: boolean; propertyCount: number };

export type DuplicateMatch = ExistingClientFacts & { reasons: string[] };

/** Shared mailbox providers: a matching domain there says nothing. */
const PUBLIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "live.com.au", "yahoo.com", "yahoo.com.au",
  "icloud.com", "me.com", "bigpond.com", "bigpond.net.au", "optusnet.com.au", "proton.me", "protonmail.com",
]);

const NAME_NOISE = new Set(["pty", "ltd", "limited", "the", "and", "co", "group", "services", "property", "properties", "holdings", "trust"]);

export function emailDomain(email: string | null | undefined): string | null {
  const at = (email ?? "").trim().toLowerCase().split("@");
  return at.length === 2 && at[1].includes(".") ? at[1] : null;
}

export function companyDomain(email: string | null | undefined): string | null {
  const domain = emailDomain(email);
  return domain && !PUBLIC_DOMAINS.has(domain) ? domain : null;
}

/** Significant words of a business name ("Seaside Hosting Pty Ltd" → ["seaside", "hosting"]). */
export function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !NAME_NOISE.has(word));
}

export function phoneDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D+/g, "");
  if (digits.length < 8) return null;
  return digits.startsWith("61") ? `0${digits.slice(2)}` : digits;
}

/** Why an existing client looks like the one being added (empty = not similar). */
export function duplicateReasons(candidate: DuplicateCandidate, existing: ExistingClientFacts): string[] {
  const reasons: string[] = [];
  const email = candidate.email?.trim().toLowerCase();
  if (email && existing.email && existing.email.trim().toLowerCase() === email) reasons.push("same email");
  else {
    const domain = companyDomain(email);
    if (domain && companyDomain(existing.email) === domain) reasons.push("same email domain");
  }
  const phone = phoneDigits(candidate.phone);
  if (phone && phoneDigits(existing.phone) === phone) reasons.push("same phone");
  const words = nameWords(candidate.name);
  const theirs = new Set(nameWords(existing.name));
  if (words.length > 0 && words[0] && theirs.has(words[0])) reasons.push("similar name");
  return reasons;
}

export function rankDuplicates(candidate: DuplicateCandidate, existing: readonly ExistingClientFacts[], limit = 3): DuplicateMatch[] {
  return existing
    .map((row) => ({ ...row, reasons: duplicateReasons(candidate, row) }))
    .filter((row) => row.reasons.length > 0)
    .sort((a, b) => b.reasons.length - a.reasons.length || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** "Seaside Stays, 2 properties, same email domain." */
export function duplicateSentence(match: DuplicateMatch): string {
  const props = `${match.propertyCount} ${match.propertyCount === 1 ? "property" : "properties"}`;
  return `${match.name}, ${props}${match.isActive ? "" : ", inactive"}, ${match.reasons.join(" and ")}.`;
}
