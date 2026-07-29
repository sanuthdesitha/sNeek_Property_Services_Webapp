/**
 * One-off cleaner form templates minted FOR A SINGLE JOB.
 *
 * Today the only minter is quote → job conversion: when a quote carries the
 * checklist the client actually agreed to (or, failing that, the base service
 * checklist), the job gets a form built from exactly that scope.
 *
 * HISTORY — why this module exists. The conversion route used to register the
 * one-off template as the PROPERTY's permanent per-job-type override
 * (`settings.propertyFormTemplateOverrides[propertyId][jobType]`). That is the
 * attachment path `generatePropertyTemplates` uses, and it is correct for a
 * property's standing checklist — but catastrophic for a one-off: every future
 * job of that type at that property then rendered one quote's scope, and the
 * admin's edits to the real global template never reached it. The owner's rule
 * is "use it for that job only", so the template is now pinned to the job
 * (`Job.formTemplateId`) and flagged `isJobScoped` — never an override, never a
 * global default, never auto-archived by a global publish.
 *
 * The writer takes its database client as an argument so it stays unit-testable
 * without Prisma, and so a caller can hand it a transaction client.
 */

/** The naming convention every quote-minted one-off follows. */
export type QuoteScopeKind = "agreed" | "standard";

/**
 * `Quote 4F2A9C — agreed scope` / `… — standard scope`. Kept in one place so
 * the maintenance backfill can recognise historical rows by exactly the string
 * the minter produced (an em dash, not a hyphen).
 */
export function quoteScopeTemplateName(quoteRef: string, kind: QuoteScopeKind): string {
  return `Quote ${quoteRef} — ${kind} scope`;
}

/**
 * Does this template name look like a quote-minted one-off? Used ONLY by the
 * backfill for rows created before `isJobScoped` existed — live code reads the
 * flag, never the name.
 */
const QUOTE_SCOPE_NAME = /^Quote\s+\S+\s+—\s+(agreed|standard)\s+scope$/;
export function isQuoteScopeTemplateName(name: string | null | undefined): boolean {
  return typeof name === "string" && QUOTE_SCOPE_NAME.test(name.trim());
}

/** The minimal database surface the writer needs (Prisma client or a tx). */
export interface JobScopedTemplateClient {
  formTemplate: { create(args: { data: Record<string, unknown>; select: { id: true } }): Promise<{ id: string }> };
  job: { update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown> };
}

/**
 * Create a one-off template and pin it to the job it was minted for. Returns
 * the new template id.
 *
 * Deliberately does NOT touch `propertyFormTemplateOverrides` — that is the bug
 * this module was extracted to make impossible to reintroduce by accident.
 */
export async function materializeJobScopedFormTemplate(
  client: JobScopedTemplateClient,
  params: { jobId: string; name: string; serviceType: string; schema: unknown }
): Promise<string> {
  const template = await client.formTemplate.create({
    data: {
      name: params.name,
      serviceType: params.serviceType,
      kind: "CUSTOM",
      version: 1,
      isActive: true,
      // Active (its job must render it) but never a candidate for global
      // resolution, and protected from the global publish sweep.
      isJobScoped: true,
      schema: params.schema,
      publishedAt: new Date(),
    },
    select: { id: true },
  });

  await client.job.update({
    where: { id: params.jobId },
    data: { formTemplateId: template.id },
  });

  return template.id;
}
