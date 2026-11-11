// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { maintenanceItemScope } from "@/lib/maintenance/item-scope";

describe("maintenance item visibility", () => {
  it("limits a maintenance worker to jobs assigned to them", () => {
    expect(maintenanceItemScope({ id: "worker-user", role: "MAINTENANCE" })).toEqual({
      assignedWorker: { userId: "worker-user" },
    });
  });

  it.each(["ADMIN", "OPS_MANAGER"])("lets %s see every item", (role) => {
    expect(maintenanceItemScope({ id: "office", role })).toEqual({});
  });

  it.each(["CLEANER", "CLIENT", "LAUNDRY", "QA_INSPECTOR", "UNKNOWN"])(
    "shows nothing to %s",
    (role) => {
      expect(maintenanceItemScope({ id: "someone", role })).toEqual({ id: { in: [] } });
    },
  );
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("every maintenance-portal read is scoped", () => {
  const files = [
    ...sourceFiles("app/v2/maintenance"),
    "app/api/maintenance/attention-counts/route.ts",
  ].filter((path) => readFileSync(path, "utf8").includes("propertyMaintenanceItem"));

  it("finds the portal's item queries", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it.each(files)("%s applies the viewer scope to each query", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).toContain("maintenanceItemScope(");
    const queries = source.match(/propertyMaintenanceItem\s*\.\s*(findMany|findFirst|findUnique|count)/g) ?? [];
    const scoped = source.match(/\.\.\.scope\b|\.\.\.maintenanceItemScope\(|where,|where }/g) ?? [];
    expect(scoped.length).toBeGreaterThanOrEqual(queries.length);
    expect(source).not.toMatch(/propertyMaintenanceItem\s*\.\s*findUnique/);
  });
});
