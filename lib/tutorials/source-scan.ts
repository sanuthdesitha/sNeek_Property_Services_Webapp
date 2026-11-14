/**
 * Scans the application source for registered tour targets (Node only: tests
 * and scripts). A target counts when the code spreads `tourTarget("<id>")` or
 * writes `data-tour="<id>"` on an element. Tests and this folder are skipped.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["app", "components", "lib"];
// The tutorial engine itself only names targets in prose and patterns.
const SKIP = [/node_modules/, /^lib\/tutorials\//, /^components\/v2\/tutorials\//];
const CALL = /tourTarget\(\s*"([a-z][A-Za-z0-9.]*)"\s*\)/g;
const ATTRIBUTE = /data-tour="([a-z][A-Za-z0-9.]*)"/g;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
}

export type TargetScan = { found: Set<string>; files: Map<string, string[]> };

export function scanTourTargets(rootDir: string): TargetScan {
  const files: string[] = [];
  for (const root of ROOTS) walk(join(rootDir, root), files);
  const found = new Set<string>();
  const byId = new Map<string, string[]>();
  for (const file of files) {
    const rel = relative(rootDir, file).replace(/\\/g, "/");
    if (SKIP.some((pattern) => pattern.test(rel))) continue;
    const source = readFileSync(file, "utf8");
    for (const pattern of [CALL, ATTRIBUTE]) {
      for (const match of Array.from(source.matchAll(pattern))) {
        found.add(match[1]);
        byId.set(match[1], [...(byId.get(match[1]) ?? []), rel]);
      }
    }
  }
  // The Help buttons' targets are declared once, as literal calls, beside the registry.
  const registry = readFileSync(join(rootDir, "lib/tutorials/targets.ts"), "utf8");
  const helpBlock = registry.slice(registry.indexOf("HELP_TARGET_BY_PORTAL"));
  for (const match of Array.from(helpBlock.matchAll(CALL))) {
    found.add(match[1]);
    byId.set(match[1], [...(byId.get(match[1]) ?? []), "lib/tutorials/targets.ts (Help buttons)"]);
  }
  return { found, files: byId };
}
