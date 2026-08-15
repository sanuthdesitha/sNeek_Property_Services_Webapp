/**
 * ONE-OFF, IDEMPOTENT REPAIR — "property access codes are stored in plaintext".
 *
 * Bug being repaired
 * ------------------
 * Two independent leaks put door codes and alarm codes into the database in
 * the clear:
 *
 *   1. ENCRYPTION_KEY was never set in any environment. lib/security/encryption
 *      getKey() returned null, and encryptSecret() silently fell back to
 *      returning the PLAINTEXT, so Property.accessCode and Property.alarmCode
 *      have been written unencrypted since the feature shipped, while every
 *      call site read as though it were encrypting.
 *   2. lib/properties/access-info.ts copied the raw code from the request into
 *      accessInfo.codes as plain JSON, giving every accessInfo reader a second
 *      copy of the same secret.
 *
 * Both write paths are fixed now: encryptSecret() throws rather than storing
 * plaintext, and buildPropertyAccessInfo() drops `codes` on every save. This
 * script repairs the rows already written.
 *
 * What it does, per property:
 *   - accessCode / alarmCode: if already `enc:v1:…`, left untouched. If
 *     plaintext, re-written encrypted. If the flat column is empty but the
 *     legacy accessInfo.codes holds a code, that code is promoted into the
 *     encrypted column so it is not lost by the scrub.
 *   - accessInfo: the `codes` key is removed. Every other key is preserved
 *     exactly — laundryTeamUserIds and attachments especially.
 *
 * REQUIRES ENCRYPTION_KEY to be set, and it must be the SAME key the app runs
 * with. Encrypting with one key and serving with another makes every code
 * undecryptable. The script refuses to start without it.
 *
 * Usage (dry run is the DEFAULT — nothing is written without --apply). The
 * scripts tsconfig is required: it stubs `server-only`, which lib/db imports.
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/backfill/backfill-encrypt-access-codes.ts
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/backfill/backfill-encrypt-access-codes.ts --apply
 *
 * Safe to re-run: already-encrypted columns and already-scrubbed JSON are
 * skipped, so a second run reports zero work.
 *
 * NOTE: this closes the exposure going forward, but a code that has already
 * been stored in plaintext should be treated as disclosed. Rotate the physical
 * door/alarm codes after this runs.
 */
import { db } from "../../lib/db";
import { encryptSecret, isEncrypted } from "../../lib/security/encryption";

const APPLY = process.argv.includes("--apply");

/** Read the legacy plaintext code out of an accessInfo blob. */
function legacyCode(accessInfo: unknown): string | null {
  if (!accessInfo || typeof accessInfo !== "object" || Array.isArray(accessInfo)) return null;
  const value = (accessInfo as Record<string, unknown>).codes;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The accessInfo minus its `codes` key, or null when there was nothing to scrub. */
function scrubbed(accessInfo: unknown): Record<string, unknown> | null {
  if (!accessInfo || typeof accessInfo !== "object" || Array.isArray(accessInfo)) return null;
  const row = accessInfo as Record<string, unknown>;
  if (!("codes" in row)) return null;
  const { codes, ...rest } = row;
  return rest;
}

/** Mask a secret for the console — enough to identify a row, not to use it. */
function mask(value: string): string {
  if (value.length <= 2) return "*".repeat(value.length);
  return `${value[0]}${"*".repeat(Math.max(1, value.length - 2))}${value[value.length - 1]}`;
}

async function main() {
  if (!process.env.ENCRYPTION_KEY?.trim()) {
    console.error("ENCRYPTION_KEY is not set. Refusing to run — see .env.example.");
    console.error("It must be the same key the application serves with.");
    process.exitCode = 1;
    return;
  }

  const properties = await db.property.findMany({
    select: {
      id: true,
      name: true,
      suburb: true,
      accessCode: true,
      alarmCode: true,
      accessInfo: true,
    },
    orderBy: { name: "asc" },
  });

  let encryptedAccess = 0;
  let encryptedAlarm = 0;
  let promoted = 0;
  let scrubbedRows = 0;
  let untouched = 0;

  console.log(`Properties scanned: ${properties.length}`);
  console.log(APPLY ? "MODE: APPLY (writing)" : "MODE: DRY RUN (nothing is written)");
  console.log("");

  for (const property of properties) {
    const data: Record<string, unknown> = {};
    const notes: string[] = [];

    // The flat column wins; the legacy JSON is only a source when it is empty.
    const legacy = legacyCode(property.accessInfo);
    const rawAccess = property.accessCode?.trim() || "";
    const accessSource = rawAccess || legacy || "";

    if (accessSource && !isEncrypted(rawAccess)) {
      data.accessCode = encryptSecret(accessSource);
      if (!rawAccess && legacy) {
        promoted += 1;
        notes.push(`accessCode <- accessInfo.codes ${mask(legacy)}`);
      } else {
        encryptedAccess += 1;
        notes.push(`accessCode encrypted ${mask(accessSource)}`);
      }
    }

    const rawAlarm = property.alarmCode?.trim() || "";
    if (rawAlarm && !isEncrypted(rawAlarm)) {
      data.alarmCode = encryptSecret(rawAlarm);
      encryptedAlarm += 1;
      notes.push(`alarmCode encrypted ${mask(rawAlarm)}`);
    }

    const cleanedAccessInfo = scrubbed(property.accessInfo);
    if (cleanedAccessInfo) {
      data.accessInfo = cleanedAccessInfo;
      scrubbedRows += 1;
      notes.push("accessInfo.codes removed");
    }

    if (Object.keys(data).length === 0) {
      untouched += 1;
      continue;
    }

    const label = `${property.name}${property.suburb ? ` (${property.suburb})` : ""}`;
    console.log(`${APPLY ? "FIX " : "WOULD FIX "}${label}: ${notes.join("; ")}`);

    if (APPLY) {
      await db.property.update({ where: { id: property.id }, data: data as never });
    }
  }

  console.log("");
  console.log(`accessCode encrypted:          ${encryptedAccess}`);
  console.log(`accessCode promoted from JSON: ${promoted}`);
  console.log(`alarmCode encrypted:           ${encryptedAlarm}`);
  console.log(`accessInfo.codes scrubbed:     ${scrubbedRows}`);
  console.log(`already clean:                 ${untouched}`);

  if (!APPLY && encryptedAccess + promoted + encryptedAlarm + scrubbedRows > 0) {
    console.log("");
    console.log("Dry run only. Re-run with --apply to write these changes.");
    console.log("Afterwards, ROTATE the physical door/alarm codes: anything stored");
    console.log("in plaintext must be treated as already disclosed.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
