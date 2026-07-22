/**
 * Phase 2.5 — roll the STANDARD Airbnb library (catalog v7) onto the fleet.
 *
 * For every ACTIVE property that does Airbnb turnovers:
 *   1. buildDefaultSelections from the NEW library (so the v7 modules/items are
 *      present and pre-enabled where their rules match the property)
 *   2. mergeSelections over the property's SAVED selections — saved wins, so
 *      every admin toggle and every customItem is preserved; only genuinely new
 *      keys come in from the defaults
 *   3. upsert the profile with the merged selections
 *   4. generatePropertyTemplates → new FormTemplate per job type (the previous
 *      generated version is archived by that function)
 *   5. stamp syncedLibraryVersion = CATALOG_VERSION and standardAppliedAt = now
 *
 * Usage (run with the target DATABASE_URL):
 *
 *   npx tsx scripts/apply-standard-airbnb.ts --dry-run
 *   npx tsx scripts/apply-standard-airbnb.ts --property=<propertyId>   # verify one first
 *   npx tsx scripts/apply-standard-airbnb.ts --limit=5
 *   npx tsx scripts/apply-standard-airbnb.ts
 *
 * --dry-run touches nothing: it reports, per property, how many module/item keys
 * the merge would ADD and which job types would be regenerated.
 *
 * Idempotent: re-running produces the same selections; it does mint a fresh
 * template version per run, so prefer --dry-run first.
 */
import { JobType } from "@prisma/client";
import { db } from "../lib/db";
import { getChecklistLibrary, CATALOG_VERSION } from "../lib/checklists/library";
import {
  buildDefaultSelections,
  mergeSelections,
  sanitizeSelections,
  generatePropertyTemplates,
  type ProfileSelections,
} from "../lib/checklists/compose";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
}

/** How many module / item keys the merge introduces that the profile lacked. */
function countNewKeys(saved: ProfileSelections, merged: ProfileSelections) {
  let modules = 0;
  let items = 0;
  for (const [moduleKey, mod] of Object.entries(merged.modules)) {
    const before = saved.modules[moduleKey];
    if (!before) {
      modules += 1;
      items += Object.keys(mod.items).length;
      continue;
    }
    for (const itemKey of Object.keys(mod.items)) {
      if (!before.items[itemKey]) items += 1;
    }
  }
  return { modules, items };
}

async function main() {
  const dryRun = arg("dry-run") !== undefined;
  const propertyId = arg("property") || undefined;
  const limitRaw = arg("limit");
  const limit = limitRaw ? Math.max(1, Number(limitRaw) || 0) : undefined;

  // Reading the library first triggers ensureChecklistLibrarySynced, seeding the
  // v7 catalog into the target DB before anything is composed.
  const library = await getChecklistLibrary();
  console.log(`Library synced at catalog v${CATALOG_VERSION}: ${library.length} modules.\n`);

  const admin = await db.user.findFirst({
    where: { role: "ADMIN", isActive: true },
    select: { id: true, email: true },
  });
  if (!admin) throw new Error("No active ADMIN user found to attribute the approvals to.");

  const properties = await db.property.findMany({
    where: {
      isActive: true,
      ...(propertyId ? { id: propertyId } : {}),
    },
    ...(limit ? { take: limit } : {}),
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      hasBalcony: true,
      bedrooms: true,
      bathrooms: true,
      sofaBedCount: true,
      features: true,
      checklistProfile: {
        select: { selections: true, generatedTemplateIds: true },
      },
    },
  });

  console.log(
    `${dryRun ? "[dry-run] " : ""}Considering ${properties.length} active propert${
      properties.length === 1 ? "y" : "ies"
    }…\n`
  );

  let applied = 0;
  let skipped = 0;

  for (const property of properties) {
    // Which job types to regenerate: whatever this property already had
    // generated, else Airbnb turnover. A property that has never done a turnover
    // and has no generated templates is skipped.
    const previous =
      property.checklistProfile?.generatedTemplateIds &&
      typeof property.checklistProfile.generatedTemplateIds === "object"
        ? (property.checklistProfile.generatedTemplateIds as Record<string, string>)
        : {};
    const existingJobTypes = Object.keys(previous) as JobType[];
    const doesTurnover =
      existingJobTypes.includes(JobType.AIRBNB_TURNOVER) ||
      (await db.job.count({
        where: { propertyId: property.id, jobType: JobType.AIRBNB_TURNOVER },
      })) > 0;

    if (!doesTurnover) {
      skipped++;
      console.log(`  - ${property.name}: no Airbnb turnover — skipped.`);
      continue;
    }

    const jobTypes = Array.from(
      new Set<JobType>([...existingJobTypes, JobType.AIRBNB_TURNOVER])
    );

    const saved = sanitizeSelections(property.checklistProfile?.selections ?? null);
    const defaults = buildDefaultSelections(library, property as any);
    const merged = mergeSelections(defaults, saved);
    const added = countNewKeys(saved, merged);

    console.log(
      `  ${dryRun ? "~" : "+"} ${property.name}: +${added.modules} module(s), +${
        added.items
      } item(s); ${dryRun ? "would regenerate" : "regenerating"} [${jobTypes.join(", ")}]` +
        ` (keeps ${merged.customItems.length} custom item(s))`
    );

    if (dryRun) continue;

    await db.propertyChecklistProfile.upsert({
      where: { propertyId: property.id },
      create: {
        propertyId: property.id,
        selections: merged as any,
        status: "DRAFT",
      },
      update: { selections: merged as any },
    });

    try {
      await generatePropertyTemplates({
        propertyId: property.id,
        jobTypes,
        actorUserId: admin.id,
      });
    } catch (err: any) {
      console.error(`    FAILED — ${err?.message}`);
      continue;
    }

    await db.propertyChecklistProfile.update({
      where: { propertyId: property.id },
      data: { syncedLibraryVersion: CATALOG_VERSION, standardAppliedAt: new Date() },
    });
    applied++;
  }

  console.log(
    `\n${dryRun ? "[dry-run] " : ""}Done. ${dryRun ? "would apply to" : "applied to"} ${
      dryRun ? properties.length - skipped : applied
    }, skipped ${skipped}.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
