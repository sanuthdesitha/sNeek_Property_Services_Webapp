/**
 * Accountability rollout runbook: re-approve every property checklist profile
 * so the generated FormTemplates pick up the new library content (rotational /
 * exception / final-inspection modules seeded by catalog v4).
 *
 * Equivalent to pressing "Approve" on each property's Checklist tab with the
 * same job types as its previous approval. Run with the target DATABASE_URL:
 *
 *   DATABASE_URL=<url> npx tsx scripts/regenerate-checklists.ts
 *
 * Reading the library first triggers ensureChecklistLibrarySynced, seeding the
 * new modules/items into the target DB before any template is composed.
 */
import { db } from "../lib/db";
import { getChecklistLibrary } from "../lib/checklists/library";
import { generatePropertyTemplates } from "../lib/checklists/compose";
import type { JobType } from "@prisma/client";

async function main() {
  // Seeds catalog content (idempotent, preserves admin edits).
  const library = await getChecklistLibrary();
  console.log(`Library synced: ${library.length} modules.`);

  const admin = await db.user.findFirst({
    where: { role: "ADMIN", isActive: true },
    select: { id: true, email: true },
  });
  if (!admin) throw new Error("No active ADMIN user found to attribute the approvals to.");
  console.log(`Acting as admin ${admin.email}`);

  const profiles = await db.propertyChecklistProfile.findMany({
    select: {
      propertyId: true,
      status: true,
      generatedTemplateIds: true,
      property: { select: { name: true } },
    },
  });

  let done = 0;
  let skipped = 0;
  for (const profile of profiles) {
    const previous =
      profile.generatedTemplateIds && typeof profile.generatedTemplateIds === "object"
        ? (profile.generatedTemplateIds as Record<string, string>)
        : {};
    const jobTypes = Object.keys(previous) as JobType[];
    if (jobTypes.length === 0) {
      console.log(`- ${profile.property?.name ?? profile.propertyId}: never approved, skipping.`);
      skipped++;
      continue;
    }
    try {
      const result = await generatePropertyTemplates({
        propertyId: profile.propertyId,
        jobTypes,
        actorUserId: admin.id,
      });
      const kinds = Object.keys(result.generated).join(", ") || "none";
      console.log(`- ${profile.property?.name ?? profile.propertyId}: regenerated [${kinds}]`);
      done++;
    } catch (err: any) {
      console.error(`- ${profile.property?.name ?? profile.propertyId}: FAILED — ${err?.message}`);
    }
  }
  console.log(`\nDone. Regenerated ${done} profiles, skipped ${skipped}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
