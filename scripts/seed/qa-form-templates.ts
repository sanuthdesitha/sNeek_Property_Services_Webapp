/**
 * Idempotent seed for the QA form template library.
 *
 * Run with: `npx tsx scripts/seed/qa-form-templates.ts`
 *
 * Deduplicates by (name, version). Safe to re-run.
 */
import { PrismaClient } from "@prisma/client";
import { ALL_QA_SEED_TEMPLATES } from "@/lib/qa/seed-templates";

const db = new PrismaClient();

async function main() {
  let seeded = 0;
  let skipped = 0;

  for (const template of ALL_QA_SEED_TEMPLATES) {
    const existing = await db.qaFormTemplate.findFirst({
      where: { name: template.name, version: template.version },
    });

    if (existing) {
      console.log(`[skip] ${template.name} v${template.version} (already exists, id=${existing.id})`);
      skipped++;
      continue;
    }

    const created = await db.qaFormTemplate.create({
      data: {
        name: template.name,
        serviceType: template.serviceType,
        version: template.version,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        schema: template.schema as any,
        isActive: true,
      },
    });

    console.log(`[ok] seeded ${template.name} v${template.version} (id=${created.id})`);
    seeded++;
  }

  console.log(`\nDone. seeded=${seeded} skipped=${skipped} total=${ALL_QA_SEED_TEMPLATES.length}`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
