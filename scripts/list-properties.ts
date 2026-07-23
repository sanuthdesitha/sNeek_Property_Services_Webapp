/**
 * Prints active properties with their ids + the feature flags that drive the
 * standard-Airbnb conditionals (dishwasher / balcony / sofa bed), so you can
 * pick a good pilot property for the checklist rollout:
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/list-properties.ts
 */
import { db } from "@/lib/db";

async function main() {
  const rows = await db.property.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      suburb: true,
      bedrooms: true,
      bathrooms: true,
      hasBalcony: true,
      sofaBedCount: true,
      features: true,
      // NOTE: deliberately selects only columns that exist BEFORE the pending
      // migrations, so this helper works whether or not you've run
      // `prisma migrate deploy` yet.
      checklistProfile: { select: { status: true } },
    },
    orderBy: { name: "asc" },
  });

  for (const p of rows) {
    const f = (p.features ?? {}) as Record<string, unknown>;
    const tags = [
      f.dishwasher ? "dishwasher" : "",
      p.hasBalcony ? "balcony" : "",
      (p.sofaBedCount ?? 0) > 0 ? "sofabed" : "",
    ].filter(Boolean);
    const profile = p.checklistProfile ? p.checklistProfile.status : "no-profile";
    console.log(
      [
        p.id,
        p.name,
        p.suburb || "-",
        `${p.bedrooms}bd/${p.bathrooms}ba`,
        tags.length ? tags.join(",") : "-",
        profile,
      ].join("  |  "),
    );
  }
  console.log(`\n${rows.length} active properties.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
