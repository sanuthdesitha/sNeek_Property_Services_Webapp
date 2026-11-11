// @vitest-environment node
/**
 * Severity shown as Low / Medium / High on the admin Quality surfaces
 * (owner decision, sixth set, Wave C): display only, one mapping.
 */
import { describe, expect, it, vi } from "vitest";
import { QaIssueSeverity } from "@prisma/client";

vi.mock("@/lib/db", () => ({ db: {} }));

import { SEVERITY_LABEL, severityCountLabel, severityLabel } from "@/lib/quality/severity";
import { ISSUE_SEVERITIES } from "@/lib/quality/types";
import { parseIssueFiltersStrict } from "@/lib/quality/filters";
import { qualityIssuesCsv } from "@/lib/quality/issue-list";
import type { QualityIssueRow } from "@/lib/quality/issue-rows";

describe("one mapping for every real severity", () => {
  it("covers exactly the stored enum: three levels, no fourth", () => {
    expect(Object.values(QaIssueSeverity).sort()).toEqual([...ISSUE_SEVERITIES].sort());
    expect(Object.keys(SEVERITY_LABEL).sort()).toEqual([...ISSUE_SEVERITIES].sort());
  });

  it("maps minor / major / critical to Low / Medium / High", () => {
    expect(severityLabel("MINOR")).toBe("Low");
    expect(severityLabel("MAJOR")).toBe("Medium");
    expect(severityLabel("CRITICAL")).toBe("High");
    expect(severityCountLabel(2, "MINOR")).toBe("2 low");
    expect(severityCountLabel(1, "MAJOR")).toBe("1 med");
    expect(severityCountLabel(4, "CRITICAL")).toBe("4 high");
  });

  it("never folds an unknown value into a level", () => {
    expect(severityLabel("SEVERE")).toBe("Severe");
    expect(severityLabel(null)).toBe("–");
  });
});

describe("stored and query values are unchanged", () => {
  it("the severity filter still reads the stored values and refuses a label", () => {
    expect(parseIssueFiltersStrict(new URLSearchParams("severity=CRITICAL")).severity).toBe("CRITICAL");
    expect(() => parseIssueFiltersStrict(new URLSearchParams("severity=High"))).toThrow();
  });

  it("the CSV keeps the stored value and adds the label column", () => {
    const row = {
      id: "i1",
      createdAt: "2026-11-06T01:00:00.000Z",
      cleaner: { id: "c1", name: "Marco" },
      job: { id: "j1", jobNumber: "J1", scheduledDate: null, propertyName: "Manly Loft", propertySuburb: null },
      property: null,
      category: "linen",
      severity: "CRITICAL",
      rectificationStatus: "PENDING",
      rectificationMinutes: null,
      rectificationCost: null,
      falseConfirmation: "NONE",
      raisedBy: { id: "q1", name: "Dana" },
      payAdjustment: null,
      description: "Stained sheet",
    } as unknown as QualityIssueRow;
    const [header, line] = qualityIssuesCsv([row], (key) => key).trim().split("\r\n");
    const columns = header.split(",");
    const values = line.split(",");
    expect(columns.slice(5, 7)).toEqual(["Severity", "Severity label"]);
    expect(values.slice(5, 7)).toEqual(["CRITICAL", "High"]);
  });
});
