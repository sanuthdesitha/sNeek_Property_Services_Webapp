import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * ALLOWLIST GUARD for the cleaner pay-adjustment payload.
 *
 * `GET/POST /api/cleaner/pay-adjustments` used to answer with `{ ...row }` — a
 * whole-row spread of `CleanerPayAdjustment`, which handed the cleaner the
 * reviewing admin's private `adminNote`, the reviewer's id, the auto-proposal
 * `sourceKey`, and both settlement stamps. The spread is the real hazard: any
 * column added to the model later would leak by default.
 *
 * This test reads the route source and asserts the shape stays explicit. It is
 * deliberately source-level rather than a live fetch — the point is to catch a
 * `...row` reappearing in review, not to exercise the handler.
 */

const ROUTE = path.join(process.cwd(), "app/api/cleaner/pay-adjustments/route.ts");
const source = fs.readFileSync(ROUTE, "utf8");

/** Columns that must never reach a cleaner. */
const FORBIDDEN_FIELDS = [
  "adminNote",
  "reviewedById",
  "sourceKey",
  "includedInPayrollRunId",
  "includedInCleanerInvoiceId",
  "includedInCleanerInvoiceAt",
];

/** The DTO body — everything between the mapper's `return {` and its close. */
function dtoBody(): string {
  const start = source.indexOf("function toCleanerAdjustmentDto");
  expect(start).toBeGreaterThan(-1);
  const returnAt = source.indexOf("return {", start);
  expect(returnAt).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", returnAt);
  return source.slice(returnAt, end);
}

describe("cleaner pay-adjustment DTO", () => {
  it("has no whole-row spread in either response", () => {
    // `...row` / `...created` is exactly how the leak happened. Strip comments
    // first — the mapper's own docs describe the old shape.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\.\.\.\s*row\b/);
    expect(code).not.toMatch(/\.\.\.\s*created\b/);
  });

  it("emits no internal field from the mapper", () => {
    const body = dtoBody();
    for (const field of FORBIDDEN_FIELDS) {
      // The settlement stamps may be READ to derive `settled`, but must not be
      // emitted as keys of the DTO.
      expect(body).not.toMatch(new RegExp(`^\\s*${field}\\s*:`, "m"));
    }
  });

  it("still exposes what the cleaner legitimately needs", () => {
    const body = dtoBody();
    for (const field of [
      "id",
      "jobId",
      "status",
      "requestedAmount",
      "approvedAmount",
      "cleanerNote",
      "requestedAt",
      "reviewedAt",
      "attachmentUrls",
    ]) {
      expect(body).toMatch(new RegExp(`^\\s*${field}\\s*:`, "m"));
    }
  });

  it("reports settlement as a derived boolean, not the rail ids", () => {
    const body = dtoBody();
    expect(body).toMatch(/^\s*settled\s*:/m);
    expect(body).toContain("Boolean(row.includedInPayrollRunId || row.includedInCleanerInvoiceId)");
  });

  it("routes both responses through the mapper", () => {
    expect(source).toContain("rows.map(toCleanerAdjustmentDto)");
    expect(source).toContain("toCleanerAdjustmentDto(created)");
  });
});
