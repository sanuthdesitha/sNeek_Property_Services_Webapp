import { describe, it, expect } from "vitest";
import {
  buildPublicVerificationVm,
  buildDamageVerificationVm,
  generateVerificationCode,
} from "@/lib/reports/verification";
import {
  CODE_LENGTH,
  formatVerificationCode,
  normalizeVerificationCode,
} from "@/lib/reports/verification-code";

describe("verification codes", () => {
  it("generates 16-char Crockford base32 codes with no ambiguous characters", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateVerificationCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/);
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it("generates distinct codes", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateVerificationCode()));
    expect(seen.size).toBe(500);
  });

  it("formats codes in groups of four", () => {
    expect(formatVerificationCode("ABCDEFGHJKMNPQRS")).toBe("ABCD-EFGH-JKMN-PQRS");
  });

  it("normalizes human input: case, dashes, spaces and Crockford ambiguity", () => {
    expect(normalizeVerificationCode("abcd-efgh-jkmn-pqrs")).toBe("ABCDEFGHJKMNPQRS");
    expect(normalizeVerificationCode(" ABCD EFGH JKMN PQRS ")).toBe("ABCDEFGHJKMNPQRS");
    // I/L → 1, O → 0
    expect(normalizeVerificationCode("ObCd-efgh-jkmn-pqrI")).toBe("0BCDEFGHJKMNPQR1");
    // Wrong length or characters → null
    expect(normalizeVerificationCode("ABCD")).toBeNull();
    expect(normalizeVerificationCode("ABCD-EFGH-JKMN-PQRU")).toBeNull();
    expect(normalizeVerificationCode("")).toBeNull();
  });
});

describe("buildPublicVerificationVm", () => {
  const row = {
    createdAt: new Date("2026-07-12T02:00:00.000Z"),
    revokedAt: null as Date | null,
    job: {
      jobType: "AIRBNB_TURNOVER",
      scheduledDate: new Date("2026-07-12T02:00:00.000Z"),
      property: { suburb: "Sydney" },
      assignments: [
        { user: { name: "Alice Nguyen" } },
        { user: { name: "Bob van der Berg" } },
        { user: null },
      ],
      timeLogs: [
        {
          startedAt: new Date("2026-07-11T23:05:00.000Z"),
          stoppedAt: new Date("2026-07-12T01:35:00.000Z"),
          durationM: 150,
        },
      ],
    },
  };

  it("maps the minimal public fields: suburb, date, type, first names, clock times", () => {
    const vm = buildPublicVerificationVm(row);
    expect(vm.status).toBe("verified");
    expect(vm.suburb).toBe("Sydney");
    expect(vm.dateLabel).toBe("12 July 2026");
    expect(vm.jobTypeLabel).toBe("AIRBNB TURNOVER");
    expect(vm.cleanerFirstNames).toEqual(["Alice", "Bob"]);
    expect(vm.clockInLabel).toBe("12 Jul 2026, 9:05 am");
    expect(vm.clockOutLabel).toBe("12 Jul 2026, 11:35 am");
    expect(vm.clockOutMissing).toBe(false);
  });

  it("exposes ONLY the minimal public fields — no pay, addresses or notes can leak", () => {
    const vm = buildPublicVerificationVm(row);
    // `kind` was added when damage reports became separately verifiable. It is
    // safe for a stranger (it says which KIND of document, nothing about it),
    // and this exact-key assertion is what forces that judgement to be made
    // deliberately rather than by accident.
    expect(Object.keys(vm).sort()).toEqual([
      "cleanerFirstNames",
      "clockInLabel",
      "clockOutLabel",
      "clockOutMissing",
      "dateLabel",
      "issuedLabel",
      "jobTypeLabel",
      "kind",
      "status",
      "suburb",
    ]);
  });

  it("labels a cleaning verification as CLEANING", () => {
    expect(buildPublicVerificationVm(row).kind).toBe("CLEANING");
  });

  it("marks revoked codes and reports missing clock-outs honestly", () => {
    const revoked = buildPublicVerificationVm({ ...row, revokedAt: new Date() });
    expect(revoked.status).toBe("revoked");

    const open = buildPublicVerificationVm({
      ...row,
      job: {
        ...row.job,
        timeLogs: [
          { startedAt: new Date("2026-07-11T23:05:00.000Z"), stoppedAt: null, durationM: null },
        ],
      },
    });
    expect(open.clockOutMissing).toBe(true);
    expect(open.clockOutLabel).toBeNull();
  });
});

describe("buildDamageVerificationVm", () => {
  const damageRow = {
    createdAt: new Date("2026-08-16T04:00:00.000Z"),
    revokedAt: null as Date | null,
    damageReport: {
      submittedAt: new Date("2026-08-15T22:00:00.000Z"),
      reportedBy: { name: "Alice Smith" },
      property: { suburb: "Bondi" },
      _count: { items: 3 },
    },
  };

  it("confirms the report exists without describing it", () => {
    const vm = buildDamageVerificationVm(damageRow);
    expect(vm.kind).toBe("DAMAGE");
    expect(vm.status).toBe("verified");
    expect(vm.suburb).toBe("Bondi");
    expect(vm.jobTypeLabel).toBe("Damage report");
    expect(vm.damageItemCount).toBe(3);
  });

  it("gives a first name only, never a full name", () => {
    const vm = buildDamageVerificationVm(damageRow);
    expect(vm.cleanerFirstNames).toEqual(["Alice"]);
    expect(JSON.stringify(vm)).not.toContain("Smith");
  });

  it("leaks nothing about WHAT was damaged", () => {
    // A verification code can be forwarded to anyone, so the payload must not
    // carry descriptions, severities, causes, costs or photo keys.
    const keys = Object.keys(buildDamageVerificationVm(damageRow)).sort();
    expect(keys).toEqual([
      "cleanerFirstNames",
      "clockInLabel",
      "clockOutLabel",
      "clockOutMissing",
      "damageItemCount",
      "dateLabel",
      "issuedLabel",
      "jobTypeLabel",
      "kind",
      "status",
      "suburb",
    ]);
  });

  it("omits clock times, which belong to a clean and not to a report", () => {
    const vm = buildDamageVerificationVm(damageRow);
    expect(vm.clockInLabel).toBeNull();
    expect(vm.clockOutLabel).toBeNull();
    expect(vm.clockOutMissing).toBe(false);
  });

  it("marks a revoked damage code", () => {
    expect(buildDamageVerificationVm({ ...damageRow, revokedAt: new Date() }).status).toBe("revoked");
  });
});
