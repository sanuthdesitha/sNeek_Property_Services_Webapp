import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A server component that reads a plain value (a constant, array or helper)
 * exported from a "use client" module gets a client reference instead, and the
 * page throws at request time ("Attempted to call includes() from the server",
 * "Could not find the module … in the React Client Manifest"). The type check
 * and the build both pass, so this scan is the guard. Components and hooks are
 * fine to import; constants and helpers must live in a plain module.
 */
const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

function isClientModule(path: string): boolean {
  return /^\s*["']use client["']/.test(readFileSync(path, "utf8").slice(0, 400));
}

function resolveAlias(spec: string): string | null {
  const base = join(ROOT, spec.replace(/^@\//, ""));
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

function offendingImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  const importPattern = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+"(@\/[^"]+)"/g;
  for (const match of source.matchAll(importPattern)) {
    if (match[1]) continue;
    const target = resolveAlias(match[3]);
    if (!target || !isClientModule(target)) continue;
    for (const raw of match[2].split(",")) {
      const entry = raw.trim();
      if (!entry || entry.startsWith("type ")) continue;
      const name = entry.split(" as ").pop()!.trim();
      // SCREAMING_CASE constants and camelCase helpers (hooks excluded) are values.
      const isConstant = /^[A-Z][A-Z0-9_]+$/.test(name);
      const isHelper = /^[a-z]/.test(name) && !/^use[A-Z]/.test(name);
      if (isConstant || isHelper) found.push(`${file.replace(ROOT + "/", "")} reads ${name} from ${match[3]}`);
    }
  }
  return found;
}

describe("server pages do not read values from client modules", () => {
  it("finds no constant or helper imported from a \"use client\" module by a server file under app/", () => {
    const serverFiles = walk(join(ROOT, "app")).filter((file) => !isClientModule(file));
    const offences = serverFiles.flatMap(offendingImports);
    expect(offences).toEqual([]);
  });
});
