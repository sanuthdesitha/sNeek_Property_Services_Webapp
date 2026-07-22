/**
 * Phase 2.1 — bake the standard sections into every ACTIVE FormTemplate.
 *
 * Historically the arrival-evidence / reported-exceptions / sign-off sections
 * were injected at read time (lib/checklists/compose → withStandardSections,
 * applied by lib/forms/normalize-schema on both form read and submit). That
 * made them invisible to the builder: admins could not see, reorder or edit
 * them, and every read had to re-derive them.
 *
 * This script runs the injector ONCE into the stored schema and stamps
 * `standardSections: false`, which tells normalizeFormSchema to stop injecting
 * for that template. The resulting form is byte-identical for cleaners, but the
 * sections are now template-owned and fully editable.
 *
 * Usage (run with the target DATABASE_URL):
 *
 *   npx tsx scripts/bake-standard-sections.ts --dry-run
 *   npx tsx scripts/bake-standard-sections.ts
 *   npx tsx scripts/bake-standard-sections.ts --template=<id>
 *   npx tsx scripts/bake-standard-sections.ts --limit=25
 *
 * Idempotent: a template already carrying `standardSections: false` is skipped,
 * and re-running changes nothing.
 */
import { db } from "../lib/db";
import { withStandardSections } from "../lib/checklists/compose";
import {
  STANDARD_SECTION_IDS,
  schemaOptsOutOfStandardSections,
} from "../lib/forms/standard-sections";

type AnyRec = Record<string, any>;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
}

async function main() {
  const dryRun = arg("dry-run") !== undefined;
  const templateId = arg("template") || undefined;
  const limitRaw = arg("limit");
  const limit = limitRaw ? Math.max(1, Number(limitRaw) || 0) : undefined;

  const templates = await db.formTemplate.findMany({
    where: { isActive: true, ...(templateId ? { id: templateId } : {}) },
    orderBy: [{ serviceType: "asc" }, { version: "desc" }],
    ...(limit ? { take: limit } : {}),
    select: { id: true, name: true, serviceType: true, version: true, schema: true },
  });

  console.log(
    `${dryRun ? "[dry-run] " : ""}Scanning ${templates.length} active template${
      templates.length === 1 ? "" : "s"
    }…\n`
  );

  let baked = 0;
  let skipped = 0;
  let empty = 0;

  for (const template of templates) {
    const raw = (template.schema ?? {}) as AnyRec;
    const label = `${template.name} (${template.serviceType} v${template.version})`;

    if (schemaOptsOutOfStandardSections(raw)) {
      skipped++;
      console.log(`  = ${label}: already baked (standardSections:false) — skipped.`);
      continue;
    }

    const sections: AnyRec[] = Array.isArray(raw.sections) ? raw.sections : [];
    if (sections.length === 0) {
      // withStandardSections deliberately leaves an empty schema empty; stamping
      // the flag would permanently freeze it as an empty form. Leave it alone.
      empty++;
      console.log(`  ! ${label}: no sections — left untouched.`);
      continue;
    }

    const before = new Set(sections.map((s) => String(s?.id ?? "")));
    const next = withStandardSections(sections) as AnyRec[];
    const added = STANDARD_SECTION_IDS.filter(
      (id) => !before.has(id) && next.some((s) => String(s?.id ?? "") === id)
    );

    console.log(
      `  ${dryRun ? "~" : "+"} ${label}: ${
        added.length ? `would add [${added.join(", ")}]` : "no sections added (already present)"
      } → standardSections:false`
    );

    if (dryRun) continue;

    await db.formTemplate.update({
      where: { id: template.id },
      data: { schema: { ...raw, sections: next, standardSections: false } as any },
    });
    baked++;
  }

  console.log(
    `\n${dryRun ? "[dry-run] " : ""}Done. ${
      dryRun ? "would bake" : "baked"
    } ${dryRun ? templates.length - skipped - empty : baked}, skipped ${skipped}, empty ${empty}.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
