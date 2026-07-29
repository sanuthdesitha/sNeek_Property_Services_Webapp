/**
 * ONE-OFF, IDEMPOTENT REPAIR — "quote scope became the property's permanent form".
 *
 * Bug being repaired
 * ------------------
 * Converting a quote to a job used to mint a one-off CUSTOM FormTemplate for the
 * scope the client agreed to AND register it as the property's PERMANENT
 * per-job-type override in `settings.propertyFormTemplateOverrides[propertyId][jobType]`
 * (app/api/admin/quotes/[id]/convert-to-job/route.ts, `materializeJobFormTemplate`).
 * Consequence: every future job of that type at that property renders that one
 * quote's scope, and the admin's edits to the real global template never reach
 * it. The owner's decision is "use it for that job only" — the template is now
 * pinned to the job (`Job.formTemplateId`) and flagged `FormTemplate.isJobScoped`,
 * and no override is written.
 *
 * Identifying a quote-materialised one-off
 * ----------------------------------------
 * Read off the minting code, not guessed. ALL of these must hold:
 *   - `kind = CUSTOM` and `version = 1` (the minter always created v1 CUSTOM),
 *   - `parentTemplateId` is null (checklist-profile templates chain to their
 *     predecessor; a quote one-off never does),
 *   - the name matches the minter's exact convention — `Quote <REF> — agreed scope`
 *     or `… — standard scope` (em dash), see lib/forms/job-scoped-template.ts.
 * `generatePropertyTemplates` names its rows `<property> — <job type> checklist`
 * and versions them upward, so legitimate property overrides never match.
 *
 * What gets repaired (two populations)
 * ------------------------------------
 * A. OVERRIDE — a one-off still registered as a property's permanent override.
 *    This is the live bug: the override entry is removed so the property falls
 *    back to normal resolution (any other override → newest active global).
 * B. ORPHAN — a one-off that is no longer in the override map (typically
 *    overwritten by a later checklist-profile approval). Harmless before, but
 *    now that quote one-offs are not in the map at all, an unflagged orphan is
 *    a candidate for the GLOBAL fallback — it must be flagged too.
 *
 * In both cases, with --apply:
 *   - the template is flagged `isJobScoped = true` (never a global default,
 *     never auto-archived by a global publish);
 *   - where the job it was minted for can be determined, `Job.formTemplateId` is
 *     set to it so THAT job keeps rendering the scope its client agreed to.
 *
 * Determining the owning job: the quote whose ref (last 6 chars of the quote id,
 * uppercased) appears in the template name, converted, with `convertedJobId` set
 * and that job still of the same service type. When that cannot be established
 * the override is still removed (leaving it is the active bug) and the row is
 * reported as UNPINNED so a human can review it.
 *
 * Idempotent: re-running finds nothing to do once applied.
 *
 * Usage (DRY RUN BY DEFAULT — prints the plan and changes nothing):
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/backfill/unpin-quote-form-overrides.ts
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/backfill/unpin-quote-form-overrides.ts --apply
 */
import { db } from "../../lib/db";
import { getAppSettings, saveAppSettings } from "../../lib/settings";
import { isQuoteScopeTemplateName } from "../../lib/forms/job-scoped-template";

const APPLY = process.argv.includes("--apply");

interface OneOff {
  id: string;
  name: string;
  serviceType: string;
  isJobScoped: boolean;
}

interface Finding {
  kind: "override" | "orphan";
  templateId: string;
  templateName: string;
  serviceType: string;
  /** Only for `override` findings. */
  propertyId: string | null;
  propertyName: string | null;
  jobType: string | null;
  /** The job the template was minted for, when it could be determined. */
  jobId: string | null;
  jobNumber: string | null;
  quoteId: string | null;
  /** Jobs that were wrongly inheriting this one-off (override findings only). */
  affectedOtherJobs: number;
  alreadyFlagged: boolean;
  alreadyPinned: boolean;
}

/** The ref the minter embeds: last 6 chars of the quote id, uppercased. */
function quoteRefFromTemplateName(name: string): string | null {
  const match = name.trim().match(/^Quote\s+(\S+)\s+—/);
  return match ? match[1].toUpperCase() : null;
}

function isQuoteOneOff(t: {
  name: string;
  kind: string;
  version: number;
  parentTemplateId: string | null;
}): boolean {
  return (
    t.kind === "CUSTOM" &&
    t.version === 1 &&
    t.parentTemplateId === null &&
    isQuoteScopeTemplateName(t.name)
  );
}

async function main() {
  const settings = await getAppSettings();
  const overrides = settings.propertyFormTemplateOverrides ?? {};

  // Every candidate one-off in the database, by the naming convention. The rest
  // of the predicate is applied per row below.
  const quoteNamed = await db.formTemplate.findMany({
    where: { name: { startsWith: "Quote " } },
    select: {
      id: true,
      name: true,
      kind: true,
      version: true,
      serviceType: true,
      parentTemplateId: true,
      isJobScoped: true,
    },
  });
  const oneOffs = new Map<string, OneOff>();
  for (const t of quoteNamed) {
    if (!isQuoteOneOff({ ...t, kind: String(t.kind) })) continue;
    oneOffs.set(t.id, {
      id: t.id,
      name: t.name,
      serviceType: String(t.serviceType),
      isJobScoped: t.isJobScoped,
    });
  }

  // Quote ref → converted job, resolved once.
  const convertedQuotes = await db.quote.findMany({
    where: { convertedJobId: { not: null } },
    select: { id: true, convertedJobId: true, serviceType: true },
  });
  const quoteByRef = new Map(convertedQuotes.map((q) => [q.id.slice(-6).toUpperCase(), q]));

  async function owningJob(template: OneOff) {
    const ref = quoteRefFromTemplateName(template.name);
    const quote = ref ? quoteByRef.get(ref) : undefined;
    if (!quote?.convertedJobId) return null;
    const job = await db.job.findFirst({
      where: { id: quote.convertedJobId, jobType: template.serviceType as never },
      select: { id: true, jobNumber: true, formTemplateId: true },
    });
    return job ? { ...job, quoteId: quote.id } : null;
  }

  const findings: Finding[] = [];
  const nextOverrides: Record<string, Record<string, string>> = {};
  const claimed = new Set<string>();

  // ── A. Override entries pointing at a one-off ─────────────────────────────
  for (const [propertyId, perProperty] of Object.entries(overrides)) {
    const kept: Record<string, string> = {};
    for (const [jobType, templateId] of Object.entries(perProperty ?? {})) {
      if (typeof templateId !== "string" || !templateId) continue;
      const oneOff = oneOffs.get(templateId);
      if (!oneOff) {
        kept[jobType] = templateId;
        continue;
      }
      claimed.add(templateId);
      const job = await owningJob(oneOff);
      const affectedOtherJobs = await db.job.count({
        where: {
          propertyId,
          jobType: oneOff.serviceType as never,
          ...(job ? { id: { not: job.id } } : {}),
        },
      });
      findings.push({
        kind: "override",
        templateId,
        templateName: oneOff.name,
        serviceType: oneOff.serviceType,
        propertyId,
        propertyName: propertyId,
        jobType,
        jobId: job?.id ?? null,
        jobNumber: job?.jobNumber ?? null,
        quoteId: job?.quoteId ?? null,
        affectedOtherJobs,
        alreadyFlagged: oneOff.isJobScoped,
        alreadyPinned: Boolean(job && job.formTemplateId === templateId),
      });
    }
    if (Object.keys(kept).length > 0) nextOverrides[propertyId] = kept;
  }

  // ── B. Orphan one-offs (not in the override map) ──────────────────────────
  for (const oneOff of Array.from(oneOffs.values())) {
    if (claimed.has(oneOff.id)) continue;
    const job = await owningJob(oneOff);
    const alreadyFlagged = oneOff.isJobScoped;
    const alreadyPinned = Boolean(job && job.formTemplateId === oneOff.id);
    // Nothing left to do for this row — keeps the script idempotent and quiet.
    if (alreadyFlagged && (alreadyPinned || !job)) continue;
    findings.push({
      kind: "orphan",
      templateId: oneOff.id,
      templateName: oneOff.name,
      serviceType: oneOff.serviceType,
      propertyId: null,
      propertyName: null,
      jobType: null,
      jobId: job?.id ?? null,
      jobNumber: job?.jobNumber ?? null,
      quoteId: job?.quoteId ?? null,
      affectedOtherJobs: 0,
      alreadyFlagged,
      alreadyPinned,
    });
  }

  // Friendly property names for the report.
  const propertyIds = findings.map((f) => f.propertyId).filter((id): id is string => Boolean(id));
  if (propertyIds.length > 0) {
    const properties = await db.property.findMany({
      where: { id: { in: Array.from(new Set(propertyIds)) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(properties.map((p) => [p.id, p.name]));
    for (const finding of findings) {
      if (finding.propertyId) {
        finding.propertyName = nameById.get(finding.propertyId) ?? finding.propertyId;
      }
    }
  }

  const propertyCount = Object.keys(overrides).length;
  const entriesBefore = Object.values(overrides).reduce(
    (sum, perProperty) => sum + Object.keys(perProperty ?? {}).length,
    0
  );
  const entriesAfter = Object.values(nextOverrides).reduce(
    (sum, perProperty) => sum + Object.keys(perProperty).length,
    0
  );
  const overrideFindings = findings.filter((f) => f.kind === "override");
  const orphanFindings = findings.filter((f) => f.kind === "orphan");

  console.log("");
  console.log(`Mode: ${APPLY ? "APPLY (writing changes)" : "DRY RUN (no changes)"}`);
  console.log("── BEFORE ─────────────────────────────────────────────────────");
  console.log(
    `  property override entries : ${entriesBefore} across ${propertyCount} propert${propertyCount === 1 ? "y" : "ies"}`
  );
  console.log(`  quote-materialised one-off templates in the DB : ${oneOffs.size}`);
  console.log(`    …still registered as a permanent property override : ${overrideFindings.length}`);
  console.log(`    …orphaned but not yet flagged job-scoped          : ${orphanFindings.length}`);
  console.log("");

  for (const finding of findings) {
    if (finding.kind === "override") {
      console.log(`  • [OVERRIDE] ${finding.propertyName} [${finding.propertyId}] / ${finding.jobType}`);
      console.log(
        `      other jobs at this property+type that were wrongly using it: ${finding.affectedOtherJobs}`
      );
    } else {
      console.log(`  • [ORPHAN] ${finding.serviceType}`);
    }
    console.log(`      template : ${finding.templateName} (${finding.templateId})`);
    console.log(
      finding.jobId
        ? `      pin to   : job ${finding.jobNumber} (${finding.jobId})${finding.quoteId ? ` from quote ${finding.quoteId}` : ""}${finding.alreadyPinned ? " [already pinned]" : ""}`
        : `      pin to   : UNPINNED — owning job could not be determined`
    );
  }

  if (findings.length === 0) {
    console.log("  (nothing matched)");
    console.log("");
    console.log("Nothing to repair.");
    return;
  }

  const pinnable = findings.filter((f) => f.jobId && !f.alreadyPinned).length;
  const flaggable = findings.filter((f) => !f.alreadyFlagged).length;
  console.log("");
  console.log("── AFTER (planned) ────────────────────────────────────────────");
  console.log(`  property override entries : ${entriesAfter} (was ${entriesBefore})`);
  console.log(`  templates flagged isJobScoped : +${flaggable}`);
  console.log(`  jobs pinned to their own one-off : +${pinnable}`);
  console.log(
    `  one-offs left unpinned (owning job unknown — review) : ${findings.filter((f) => !f.jobId).length}`
  );

  if (!APPLY) {
    console.log("");
    console.log("Dry run — nothing written. Re-run with --apply to make these changes.");
    return;
  }

  for (const finding of findings) {
    if (!finding.alreadyFlagged) {
      await db.formTemplate.update({
        where: { id: finding.templateId },
        data: { isJobScoped: true },
      });
    }
    if (finding.jobId && !finding.alreadyPinned) {
      await db.job.update({
        where: { id: finding.jobId },
        data: { formTemplateId: finding.templateId },
      });
    }
  }
  if (entriesAfter !== entriesBefore) {
    await saveAppSettings({ propertyFormTemplateOverrides: nextOverrides as never });
  }

  console.log("");
  console.log("Applied.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => {});
  });
