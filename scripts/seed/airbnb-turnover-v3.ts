/**
 * Create "Airbnb turnover v3" (docs/forms/airbnb-turnover-v3.json) as a DRAFT.
 *
 * Usage (run with the target DATABASE_URL):
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/seed/airbnb-turnover-v3.ts            # dry run
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/seed/airbnb-turnover-v3.ts --apply
 *   ... --apply --actor=owner@example.com        # who the audit entry names (default: first active ADMIN)
 *   ... --apply --allow-missing-stock            # import even if a stock SKU has no item
 *
 * Dry run by default. It never publishes, never edits v1/v2 or any other form,
 * and never changes which form jobs use: the draft is inactive until an admin
 * publishes it in Forms. Re-running skips a form whose name already exists.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Role } from "@prisma/client";
import { db } from "../../lib/db";
import { seedFormFileAsDrafts } from "../../lib/forms/form-file-seed";

const FILE = path.resolve(__dirname, "../../docs/forms/airbnb-turnover-v3.json");

function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value === `--${name}` || value.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
}

async function resolveActorId(email: string | undefined): Promise<string> {
  const actor = email
    ? await db.user.findFirst({ where: { email: email.toLowerCase(), isActive: true, role: Role.ADMIN }, select: { id: true } })
    : await db.user.findFirst({ where: { isActive: true, role: Role.ADMIN }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!actor) throw new Error(email ? `No active ADMIN with email ${email}.` : "No active ADMIN user to record the import against.");
  return actor.id;
}

async function main() {
  const dryRun = arg("apply") === undefined;
  const actorId = await resolveActorId(arg("actor") || undefined);
  const result = await seedFormFileAsDrafts({
    text: readFileSync(FILE, "utf8"),
    actorId,
    dryRun,
    allowMissingStock: arg("allow-missing-stock") !== undefined,
  });
  for (const form of result.forms) {
    const where = form.createdId ?? form.existingId ?? "";
    console.log(`[${form.status}] ${form.name}${where ? ` (id=${where})` : ""}${form.reason ? ` — ${form.reason}` : ""}`);
    for (const entry of form.bound) console.log(`    stock ${entry.fieldId}: ${entry.sku} → ${entry.itemName}`);
    for (const entry of form.missing) console.log(`    stock ${entry.fieldId}: no item for "${entry.reference}" — pick it in the builder`);
  }
  console.log(dryRun ? "\nDry run: nothing was created. Add --apply to create the draft." : "\nDone. Open Forms → Job forms to review and publish.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
