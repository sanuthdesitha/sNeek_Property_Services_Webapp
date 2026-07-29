// Pure helpers for duplicating a FormTemplate. Kept out of the route handler so
// the naming/versioning rules are unit-testable without a database.
//
// Why they exist: the duplicate endpoint used to hard-code `${name} (Copy)`,
// so duplicating the same template twice produced two identically named rows
// ("Airbnb Turnover (Copy)" × 2) and duplicating a copy produced
// "Airbnb Turnover (Copy) (Copy)". Both read as "nothing happened" to the owner.

/** Trailing " (Copy)" / " (Copy 3)" suffix, case-insensitive. */
const COPY_SUFFIX = /\s*\(copy(?:\s+(\d+))?\)\s*$/i;

/**
 * Strip a trailing copy marker so copies of copies stay flat:
 * "Bond Clean (Copy 2)" → "Bond Clean".
 */
export function stripCopySuffix(name: string): string {
  return name.replace(COPY_SUFFIX, "").trim();
}

/**
 * Name for a duplicate of `sourceName` that does not collide with any
 * `existingNames`. First free slot wins:
 *   "Bond Clean" → "Bond Clean (Copy)" → "Bond Clean (Copy 2)" → …
 * Comparison is case-insensitive because the owner reads the list, not the DB.
 */
export function duplicateTemplateName(
  sourceName: string,
  existingNames: readonly string[] = []
): string {
  const base = stripCopySuffix(sourceName) || "Untitled template";
  const taken = new Set<string>(existingNames.map((name) => name.trim().toLowerCase()));

  const first = `${base} (Copy)`;
  if (!taken.has(first.toLowerCase())) return first;
  // Bounded loop: `taken` is finite, so a free slot exists within its size + 2.
  for (let n = 2; n <= taken.size + 2; n += 1) {
    const candidate = `${base} (Copy ${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (Copy ${Date.now()})`;
}

/**
 * Next version number for a FormKind. Versions are allocated per kind, so the
 * caller passes every existing version for that kind (empty ⇒ 1).
 */
export function nextTemplateVersion(existingVersions: readonly number[]): number {
  let highest = 0;
  for (const version of existingVersions) {
    if (Number.isFinite(version) && version > highest) highest = Math.trunc(version);
  }
  return highest + 1;
}
