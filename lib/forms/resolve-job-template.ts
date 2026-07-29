/**
 * SINGLE SOURCE OF TRUTH for "which FormTemplate does this job use?".
 *
 * The rule used to be copy-pasted into three places (the cleaner form route,
 * the job-progress estimator and the client portal), each with its own subtly
 * different ordering — which is exactly how an admin's edit to template A ends
 * up invisible on a job that actually renders template B.
 *
 * The rule, in order:
 *   1. JOB PIN — `job.formTemplateId`. A template minted FOR THIS JOB (today
 *      only by quote → job conversion, which materialises the scope the client
 *      agreed to). It wins outright, including over the property override, and
 *      applies to that one job: the pin lives on the Job row, so every other job
 *      at the property resolves normally. Guard: the pinned row must still
 *      exist, be ACTIVE (not archived) and match the job's service type — the
 *      same usability bar an override has to clear. It is deliberately NOT
 *      subject to the property-scoped / job-scoped exclusion, because being
 *      one-off is exactly why it was minted.
 *   2. PROPERTY OVERRIDE — `settings.propertyFormTemplateOverrides[propertyId][jobType]`.
 *      Only wins when that template row still exists, is ACTIVE and matches the
 *      job's service type. Property overrides are minted by
 *      `generatePropertyTemplates` (checklist-profile approval). Quote → job
 *      conversion used to write one too; it now pins instead (see step 1).
 *   3. NEWEST ACTIVE **GLOBAL** template of the same service type. Templates
 *      registered as SOME property's override are excluded here — otherwise one
 *      property's freshly generated (and therefore highest-version) checklist
 *      would silently become the default for every other property. Rows flagged
 *      `isJobScoped` are excluded for the same reason: a one-off minted for a
 *      single job must never become anybody's default.
 *
 * Ordering inside step 2 is fully deterministic: `version` alone ties constantly
 * (version numbers are allocated per FormKind, while resolution happens per
 * serviceType), and a tie left to the database's arbitrary row order is the
 * "sometimes my edit applies, sometimes it doesn't" bug. Tie-break chain:
 * version → publishedAt → updatedAt → createdAt → id, all newest/highest first.
 *
 * Pure + dependency-free so it can be unit-tested and reused on both sides of
 * the wire (the builder's impact panel resolves with the same function the
 * runtime uses).
 */

export type TemplateOverridesMap = Record<
  string,
  Record<string, string | undefined | null> | undefined | null
>;

export interface ResolvableFormTemplate {
  id: string;
  serviceType: string;
  isActive: boolean;
  version: number;
  publishedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
  /** Minted for a single job — never a global default. Absent = false. */
  isJobScoped?: boolean | null;
}

export type TemplateSource = "job_pin" | "property_override" | "global_latest" | "none";

export interface ResolvedFormTemplate<T extends ResolvableFormTemplate> {
  template: T | null;
  source: TemplateSource;
  /** The template pinned to the job itself, even if unusable. */
  pinnedJobTemplateId: string | null;
  /** The override id configured for this property+jobType, even if unusable. */
  configuredPropertyTemplateId: string | null;
  /**
   * True when an override IS configured but could not be used (row missing,
   * archived, or pointing at a different service type). The caller fell back to
   * the global default — worth surfacing, it is a silent divergence otherwise.
   */
  overrideUnusable: boolean;
  /**
   * True when the job carries a pin that could not be used (row missing,
   * archived, or wrong service type). The job then resolves as if unpinned —
   * again a silent divergence unless it is surfaced.
   */
  pinUnusable: boolean;
}

/**
 * Every template id registered as SOME property's per-job-type override.
 * These are property-scoped and must never be picked by the global fallback.
 */
export function collectPropertyScopedTemplateIds(
  overrides: TemplateOverridesMap | null | undefined
): Set<string> {
  const ids = new Set<string>();
  for (const perProperty of Object.values(overrides ?? {})) {
    for (const templateId of Object.values(perProperty ?? {})) {
      if (typeof templateId === "string" && templateId) ids.add(templateId);
    }
  }
  return ids;
}

function toTime(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * Deterministic "newest first" comparator for form templates. Exported so the
 * admin UI can sort a candidate list exactly the way the runtime does.
 */
export function compareTemplateRecency(
  a: ResolvableFormTemplate,
  b: ResolvableFormTemplate
): number {
  if (a.version !== b.version) return b.version - a.version;
  const published = toTime(b.publishedAt) - toTime(a.publishedAt);
  if (published !== 0) return published;
  const updated = toTime(b.updatedAt) - toTime(a.updatedAt);
  if (updated !== 0) return updated;
  const created = toTime(b.createdAt) - toTime(a.createdAt);
  if (created !== 0) return created;
  // Final, always-decisive tie-break so the answer never depends on row order.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The GLOBAL default template for a service type: newest active template of
 * that service type that is neither registered as any property's override nor
 * flagged as a job-scoped one-off.
 */
export function pickGlobalDefaultTemplate<T extends ResolvableFormTemplate>(
  templates: readonly T[],
  jobType: string,
  propertyScopedTemplateIds: ReadonlySet<string>
): T | null {
  const candidates = templates.filter(
    (t) =>
      t.isActive &&
      t.serviceType === jobType &&
      !t.isJobScoped &&
      !propertyScopedTemplateIds.has(t.id)
  );
  if (candidates.length === 0) return null;
  return [...candidates].sort(compareTemplateRecency)[0] ?? null;
}

/**
 * Is this template usable AS the job's form? Same bar for a pin and for a
 * property override: the row must be present in the candidate set, still active
 * (a draft/archived row is never live) and be for this service type.
 */
function findUsableTemplate<T extends ResolvableFormTemplate>(
  templates: readonly T[],
  templateId: string | null,
  jobType: string
): T | null {
  if (!templateId) return null;
  return (
    templates.find((t) => t.id === templateId && t.isActive && t.serviceType === jobType) ?? null
  );
}

/**
 * Resolve the template a job renders. `templates` may be the full active set or
 * just the rows for this service type — filtering is done here either way.
 */
export function resolveJobFormTemplate<T extends ResolvableFormTemplate>(params: {
  jobType: string;
  propertyId: string;
  overrides: TemplateOverridesMap | null | undefined;
  templates: readonly T[];
  /** `Job.formTemplateId` — a template minted for THIS job. Highest priority. */
  jobTemplateId?: string | null;
}): ResolvedFormTemplate<T> {
  const { jobType, propertyId, overrides, templates } = params;
  const pinnedJobTemplateId =
    typeof params.jobTemplateId === "string" && params.jobTemplateId ? params.jobTemplateId : null;
  const configured = overrides?.[propertyId]?.[jobType];
  const configuredPropertyTemplateId =
    typeof configured === "string" && configured ? configured : null;

  // 1. The job's own pin. Wins over everything, including a property override —
  //    it was minted for this job specifically. Being job-scoped (or even
  //    property-scoped) is not disqualifying here, only being unusable is.
  const pinned = findUsableTemplate(templates, pinnedJobTemplateId, jobType);
  if (pinned) {
    return {
      template: pinned,
      source: "job_pin",
      pinnedJobTemplateId,
      configuredPropertyTemplateId,
      overrideUnusable: false,
      pinUnusable: false,
    };
  }
  const pinUnusable = Boolean(pinnedJobTemplateId);

  // 2. The property's standing override for this job type.
  const override = findUsableTemplate(templates, configuredPropertyTemplateId, jobType);
  if (override) {
    return {
      template: override,
      source: "property_override",
      pinnedJobTemplateId,
      configuredPropertyTemplateId,
      overrideUnusable: false,
      pinUnusable,
    };
  }

  // 3. The newest active global template for this service type.
  const scoped = collectPropertyScopedTemplateIds(overrides);
  const global = pickGlobalDefaultTemplate(templates, jobType, scoped);
  return {
    template: global,
    source: global ? "global_latest" : "none",
    pinnedJobTemplateId,
    configuredPropertyTemplateId,
    overrideUnusable: Boolean(configuredPropertyTemplateId),
    pinUnusable,
  };
}

/**
 * Which property ids override the given service type (and with which template).
 * Powers the builder warning "3 properties override this service type — edits
 * here will not reach them".
 */
export function propertiesOverridingServiceType(
  overrides: TemplateOverridesMap | null | undefined,
  jobType: string
): Array<{ propertyId: string; templateId: string }> {
  const out: Array<{ propertyId: string; templateId: string }> = [];
  for (const [propertyId, perProperty] of Object.entries(overrides ?? {})) {
    const templateId = perProperty?.[jobType];
    if (typeof templateId === "string" && templateId) out.push({ propertyId, templateId });
  }
  return out.sort((a, b) => (a.propertyId < b.propertyId ? -1 : a.propertyId > b.propertyId ? 1 : 0));
}

/** The property ids whose override points at this exact template id. */
export function propertiesUsingTemplate(
  overrides: TemplateOverridesMap | null | undefined,
  templateId: string
): string[] {
  const out: string[] = [];
  for (const [propertyId, perProperty] of Object.entries(overrides ?? {})) {
    for (const value of Object.values(perProperty ?? {})) {
      if (value === templateId) {
        out.push(propertyId);
        break;
      }
    }
  }
  return out.sort();
}
