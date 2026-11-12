// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_CATALOG, SEND_HELPER_CALL_PATTERN, SEND_HELPER_MODULES, catalogEntry, catalogEntryForEventKey,
  catalogEntryForSubject, fallbackTypes,
} from "@/lib/notifications/catalog";

/**
 * Static analysis over the source: every file that calls a low-level send
 * helper is a producer and must be listed by a catalog entry, so a new
 * notification cannot ship without appearing in the notifications area.
 */
const ROOT = process.cwd();
const SCANNED = ["app", "lib", "workers"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(relative(ROOT, path).split("\\").join("/"));
    }
  }
  return out;
}

const producers = SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir)))
  .filter((file) => !SEND_HELPER_MODULES.includes(file))
  .filter((file) => SEND_HELPER_CALL_PATTERN.test(readFileSync(join(ROOT, file), "utf8")));
const listed = new Set(NOTIFICATION_CATALOG.flatMap((entry) => entry.producers));

describe("notification catalog completeness", () => {
  it("lists every file that sends a notification", () => {
    const missing = producers.filter((file) => !listed.has(file));
    expect(missing, `Add these producers to a catalog entry in lib/notifications/catalog-*.ts:\n${missing.join("\n")}`).toEqual([]);
    expect(producers.length).toBeGreaterThan(100);
  });

  it("lists only files that exist", () => {
    expect(Array.from(listed).filter((file) => !existsSync(join(ROOT, file)))).toEqual([]);
  });

  it("knows every pipeline event key a producer queues", () => {
    const keys = producers.flatMap((file) => Array.from(readFileSync(join(ROOT, file), "utf8").matchAll(/eventKey:\s*"([a-z][a-z0-9_.-]+)"/g), (match) => match[1]));
    const unknown = keys.filter((key) => !catalogEntryForEventKey(key));
    expect(unknown).toEqual([]);
  });
});

describe("notification catalog entries", () => {
  it("has unique, stable keys and consistent transports", () => {
    const keys = NOTIFICATION_CATALOG.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of NOTIFICATION_CATALOG) {
      expect(entry.defaultTransports.every((transport) => entry.transports.includes(transport)), entry.key).toBe(true);
      expect(entry.producers.length, entry.key).toBeGreaterThan(0);
      if (entry.path === "PIPELINE" || entry.path === "PIPELINE_WITH_FALLBACK") expect(entry.eventKeys?.length, entry.key).toBeGreaterThan(0);
      if (entry.preferences === "ADMIN_SWITCH") expect(entry.initiator, entry.key).toBe("OFFICE_MANUAL");
    }
  });

  it("records the manual job reminder as pipeline with direct fallback, office-directed by default", () => {
    const reminder = catalogEntry("job.reminder.manual")!;
    expect(reminder).toMatchObject({ path: "PIPELINE_WITH_FALLBACK", preferences: "ADMIN_SWITCH", producers: ["lib/jobs/job-reminder.ts"] });
    expect(reminder.defaultTransports).toEqual(["INBOX", "MOBILE_PUSH", "WEB_PUSH"]);
    expect(fallbackTypes().find((type) => type.key === "job.reminder.manual")?.transports).toEqual(["WEB_PUSH", "EMAIL"]);
  });

  it("says plainly that the finance templates have no producer", () => {
    expect(catalogEntry("money.finance_events")).toMatchObject({ path: "NO_PRODUCER", defaultTransports: [] });
  });

  it("classifies legacy rows by subject and pipeline rows by event key", () => {
    expect(catalogEntryForSubject("Unfinished job reminder")?.key).toBe("job.reminder.manual");
    expect(catalogEntryForSubject("sNeek: New job offer (J-1)")?.key).toBe("job.offer");
    expect(catalogEntryForSubject("Something nobody sends")).toBeUndefined();
    expect(catalogEntryForEventKey("urgent_stock.open_need")?.key).toBe("stock.urgent_need");
  });
});
