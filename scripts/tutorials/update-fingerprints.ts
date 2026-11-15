/**
 * Refresh lib/tutorials/fingerprints.json after updating a tour.
 *
 *   npx tsx scripts/tutorials/update-fingerprints.ts
 *       records tours whose version was bumped, and new tours;
 *   npx tsx scripts/tutorials/update-fingerprints.ts --no-visible-change admin.jobs "Query only, same screen" "Your name"
 *       accepts a changed fingerprint WITHOUT a version bump, with a reason
 *       administrators can read in Settings › System › Tutorials.
 *
 * It never records a changed page at the same version without a reason.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOURS } from "../../lib/tutorials/registry";
import { scanTourTargets } from "../../lib/tutorials/source-scan";
import { tourFingerprint, type FingerprintFile } from "../../lib/tutorials/fingerprint";

const root = process.cwd();
const file = join(root, "lib/tutorials/fingerprints.json");
const current: FingerprintFile = JSON.parse(readFileSync(file, "utf8"));
const { found } = scanTourTargets(root);
const args = process.argv.slice(2);
const nvcIndex = args.indexOf("--no-visible-change");
const nvc = nvcIndex >= 0 ? { tourKey: args[nvcIndex + 1], reason: args[nvcIndex + 2], by: args[nvcIndex + 3] ?? "developer" } : null;
if (nvc && (!nvc.tourKey || !nvc.reason?.trim())) throw new Error("--no-visible-change needs a tour key and a reason.");

const next: FingerprintFile = {};
const refused: string[] = [];
for (const tour of TOURS) {
  const fingerprint = tourFingerprint(tour, found);
  const entry = current[tour.key];
  if (!entry || tour.version > entry.version) {
    next[tour.key] = { version: tour.version, fingerprint, noVisibleChange: entry?.noVisibleChange };
  } else if (entry.fingerprint === fingerprint || entry.noVisibleChange?.some((note) => note.fingerprint === fingerprint)) {
    next[tour.key] = entry;
  } else if (nvc && nvc.tourKey === tour.key) {
    const note = { fingerprint, reason: nvc.reason.trim(), by: nvc.by, date: new Date().toISOString().slice(0, 10) };
    next[tour.key] = { ...entry, noVisibleChange: [...(entry.noVisibleChange ?? []), note] };
  } else {
    next[tour.key] = entry;
    refused.push(tour.key);
  }
}
writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
if (refused.length) {
  console.error(`Not recorded (page changed without a version bump): ${refused.join(", ")}. Bump the tour version with a What's new step, or pass --no-visible-change <tour> "<reason>".`);
  process.exitCode = 1;
}
