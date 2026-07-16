/**
 * Build a proper per-property checklist for EVERY property, then generate its
 * FormTemplate(s).
 *
 * How it works (reuses the existing pipeline — no bespoke logic):
 *  1. getChecklistLibrary() syncs the catalog → DB library (picks up the new
 *     granular mandatory-evidence items at the current CATALOG_VERSION).
 *  2. For each property that has no PropertyChecklistProfile yet, one is created
 *     from buildDefaultSelections(library, property) — which enables exactly the
 *     modules/items applicable to that property (balcony only when hasBalcony,
 *     sofa-bed evidence only when sofaBedCount>0, coffee/dishwasher/fridge
 *     evidence only when that feature flag is set, room sections repeated by the
 *     property's bedroom/bathroom counts). Common items are shared; property
 *     specifics come from the property's own settings/features.
 *  3. generatePropertyTemplates(...) composes + publishes the per-property
 *     template(s), flips the profile to APPROVED, and records generatedTemplateIds.
 *     Existing profiles keep their admin edits (merged over defaults) and are
 *     just regenerated.
 *
 * Job types: regenerates the property's previously-approved job types when it
 * already had a profile; otherwise the distinct job types across the property's
 * jobs, falling back to AIRBNB_TURNOVER (the operating model for J02–J11).
 *
 * Run against the target DB:
 *   DATABASE_URL=<url> npx tsx scripts/seed-property-checklists.ts
 */
import { db } from "../lib/db";
import { getChecklistLibrary } from "../lib/checklists/library";
import { buildDefaultSelections, generatePropertyTemplates } from "../lib/checklists/compose";
import type { JobType } from "@prisma/client";

async function main() {
  const library = await getChecklistLibrary();
  console.log(`Library synced: ${library.length} modules.`);

  const admin = await db.user.findFirst({
    where: { role: "ADMIN", isActive: true },
    select: { id: true, email: true },
  });
  if (!admin) throw new Error("No active ADMIN user to attribute approvals to.");
  console.log(`Acting as ${admin.email}\n`);

  const properties = await db.property.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      hasBalcony: true,
      bedrooms: true,
      bathrooms: true,
      sofaBedCount: true,
      laundryEnabled: true,
      inventoryEnabled: true,
      features: true,
      checklistProfile: { select: { generatedTemplateIds: true } },
    },
  });

  let created = 0;
  let regenerated = 0;
  const failures: string[] = [];

  for (const property of properties) {
    const label = property.name ?? property.id;
    try {
      // Ensure a profile exists — create one from feature-aware defaults.
      if (!property.checklistProfile) {
        const selections = buildDefaultSelections(library as any, property as any);
        await db.propertyChecklistProfile.create({
          data: { propertyId: property.id, selections: selections as any, status: "DRAFT" },
        });
      }

      // Job types to generate: previously-approved set if any, else the
      // property's actual job types, else AIRBNB_TURNOVER.
      const prevIds =
        property.checklistProfile?.generatedTemplateIds &&
        typeof property.checklistProfile.generatedTemplateIds === "object"
          ? (property.checklistProfile.generatedTemplateIds as Record<string, string>)
          : {};
      let jobTypes = Object.keys(prevIds) as JobType[];
      if (jobTypes.length === 0) {
        const jobRows = await db.job.findMany({
          where: { propertyId: property.id },
          select: { jobType: true },
          distinct: ["jobType"],
        });
        jobTypes = jobRows.map((j) => j.jobType);
      }
      if (jobTypes.length === 0) jobTypes = ["AIRBNB_TURNOVER" as JobType];

      const result = await generatePropertyTemplates({
        propertyId: property.id,
        jobTypes,
        actorUserId: admin.id,
      });
      const kinds = Object.keys(result.generated).join(", ") || "(none composed)";
      const tag = property.checklistProfile ? "regen" : "created";
      if (property.checklistProfile) regenerated++;
      else created++;
      console.log(`- ${label}: ${tag} [${kinds}]`);
    } catch (err: any) {
      failures.push(`${label}: ${err?.message}`);
      console.error(`- ${label}: FAILED — ${err?.message}`);
    }
  }

  console.log(
    `\nDone. ${created} new profile(s), ${regenerated} regenerated, ${failures.length} failed.`
  );
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log("  " + f);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
