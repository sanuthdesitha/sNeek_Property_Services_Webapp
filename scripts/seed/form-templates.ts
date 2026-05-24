/**
 * Idempotent seed for the V1 form template library.
 *
 * Run with: `npx tsx scripts/seed/form-templates.ts`
 *
 * Upserts by (kind, version). Safe to re-run — existing rows are skipped.
 */
import { PrismaClient } from "@prisma/client";
import { ALL_SEED_TEMPLATES } from "@/lib/forms/seed-templates";

const db = new PrismaClient();

async function main() {
  let seeded = 0;
  let skipped = 0;

  for (const template of ALL_SEED_TEMPLATES) {
    const existing = await db.formTemplate.findFirst({
      where: { kind: template.kind, version: template.version },
    });

    if (existing) {
      console.log(`[skip] ${template.kind} v${template.version} (already exists, id=${existing.id})`);
      skipped++;
      continue;
    }

    const created = await db.formTemplate.create({
      data: {
        name: template.name,
        kind: template.kind,
        serviceType: template.serviceType,
        version: template.version,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        schema: template.schema as any,
        isActive: true,
        publishedAt: new Date(),
      },
    });

    console.log(`[ok] seeded ${template.kind} v${template.version} (id=${created.id})`);
    seeded++;
  }

  console.log(`\nDone. seeded=${seeded} skipped=${skipped} total=${ALL_SEED_TEMPLATES.length}`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
