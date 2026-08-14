/**
 * ONE-OFF, IDEMPOTENT REPAIR — "property tracks inventory but has none".
 *
 * Bug being repaired
 * ------------------
 * Default stock was seeded in exactly ONE place: the admin create-property POST,
 * and only when the inventory toggle was already on at that instant with a
 * non-empty item selection. Every OTHER way a property reached
 * `inventoryEnabled = true` created no PropertyStock rows at all:
 *
 *   1. prisma/migrations/20260802000000_enable_inventory_on_active_properties —
 *      a blanket `UPDATE "Property" SET "inventoryEnabled" = true` over every
 *      active property. Flag flipped, zero rows created.
 *   2. PATCH /api/admin/inventory ... /properties/[id] — the property detail
 *      "Inventory enabled" toggle. Flag flipped, zero rows created.
 *   3. Onboarding survey approval — set the flag from the consumables answers
 *      and never called the seeder.
 *
 * The result is a property whose supplies screen, restock list and shopping
 * plan are all empty. All three write paths are fixed now; this script repairs
 * the rows that were already left behind.
 *
 * Usage (dry run is the DEFAULT — nothing is written without --apply). The
 * scripts tsconfig is required: it stubs `server-only`, which lib/db imports.
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/backfill/backfill-property-default-stock.ts
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/backfill/backfill-property-default-stock.ts --apply
 *
 * Safe to re-run: ensurePropertyDefaultStock upserts with `update: {}`, so a
 * property that already has stock is left exactly as it is.
 */
import { db } from "../../lib/db";
import { ensurePropertyDefaultStock } from "../../lib/inventory/default-items";

const APPLY = process.argv.includes("--apply");

async function main() {
  const properties = await db.property.findMany({
    where: { isActive: true, inventoryEnabled: true },
    select: {
      id: true,
      name: true,
      suburb: true,
      _count: { select: { propertyStock: true } },
    },
    orderBy: { name: "asc" },
  });

  const broken = properties.filter((p) => p._count.propertyStock === 0);

  console.log(`Active properties with stock tracking on: ${properties.length}`);
  console.log(`Tracking on but ZERO stock rows:          ${broken.length}`);
  console.log("");

  if (broken.length === 0) {
    console.log("Nothing to repair.");
    return;
  }

  for (const property of broken) {
    if (!APPLY) {
      console.log(`  [dry-run] ${property.name} (${property.suburb}) → would seed default stock`);
      continue;
    }
    try {
      const { created, total } = await ensurePropertyDefaultStock(property.id);
      console.log(`  [seeded]  ${property.name} (${property.suburb}) → +${created} rows (now ${total})`);
    } catch (err) {
      console.error(`  [FAILED]  ${property.name} (${property.suburb}):`, err);
    }
  }

  console.log("");
  console.log(
    APPLY
      ? "Done. Re-run without --apply to confirm nothing is left."
      : "Dry run only. Re-run with --apply to write."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
