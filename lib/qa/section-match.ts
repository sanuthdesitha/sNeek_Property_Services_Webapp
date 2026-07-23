/**
 * QA ↔ cleaner-form section title matching.
 *
 * QA template sections are usually named after the cleaner-form sections they
 * review, plus a "— QA Inspection" style suffix (e.g. "Bedrooms — QA
 * Inspection" ↔ "Bedrooms"). This pure helper resolves which cleaner-form
 * section a QA section corresponds to so the workspace can show the cleaner's
 * photos for that area at the top of the matching QA section.
 */

/** Lowercase, strip a trailing "— QA Inspection"/"QA Inspection" suffix, strip
 *  punctuation, collapse whitespace, trim. */
export function normalizeSectionTitle(title: string): string {
  return String(title ?? "")
    .toLowerCase()
    // strip a trailing "qa inspection" (with any dash/em-dash separator before it)
    .replace(/[\s\-–—·:]*qa\s*inspection\s*$/i, "")
    // strip punctuation (keep letters/digits/whitespace)
    .replace(/[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~—–·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find the cleaner-form section whose title matches a QA section title.
 *
 * Titles match when their normalized forms are equal OR one contains the other
 * ("Bedrooms — QA Inspection" ↔ "Bedrooms", "Kitchen" ↔ "Kitchen &
 * appliances"). When several cleaner sections match, an exact (normalized)
 * match wins; otherwise the closest match — the one sharing the longest common
 * normalized overlap — is picked. Returns the ORIGINAL cleaner title, or null
 * when nothing matches.
 */
export function matchCleanerSection(qaTitle: string, cleanerTitles: string[]): string | null {
  const qa = normalizeSectionTitle(qaTitle);
  if (!qa) return null;

  let best: { title: string; score: number } | null = null;
  for (const title of cleanerTitles) {
    const cleaner = normalizeSectionTitle(title);
    if (!cleaner) continue;
    let score = 0;
    if (cleaner === qa) {
      // Exact normalized match always wins over any containment match.
      score = Number.MAX_SAFE_INTEGER;
    } else if (cleaner.includes(qa) || qa.includes(cleaner)) {
      // Containment: the shared overlap is the shorter of the two strings —
      // longer overlap = closer match.
      score = Math.min(cleaner.length, qa.length);
    } else {
      continue;
    }
    if (!best || score > best.score) best = { title, score };
  }
  return best?.title ?? null;
}
