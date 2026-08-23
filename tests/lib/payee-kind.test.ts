import { describe, it, expect } from "vitest";
import {
  invoicePayeeKind,
  payeeKindFileStem,
  payeeKindFromSnapshot,
  payeeKindLabel,
  xeroLineFallbackDescription,
} from "@/lib/invoicing/payee-kind";

describe("invoicePayeeKind", () => {
  it("reads CLEANING from cleans alone", () => {
    expect(invoicePayeeKind({ cleaningLineCount: 4, inspectionLineCount: 0 })).toBe("CLEANING");
  });

  it("reads INSPECTIONS from inspections alone", () => {
    expect(invoicePayeeKind({ cleaningLineCount: 0, inspectionLineCount: 3 })).toBe("INSPECTIONS");
  });

  it("reads MIXED when the invoice holds both", () => {
    // The case that could not exist before multi-role, and the one that made a
    // scalar copied from User.role a lie about half the document.
    expect(invoicePayeeKind({ cleaningLineCount: 4, inspectionLineCount: 3 })).toBe("MIXED");
  });

  it("treats an empty invoice as CLEANING rather than a fourth state", () => {
    // Nothing to mislabel on a document with no lines, and an UNKNOWN would
    // push a meaningless branch into every consumer.
    expect(invoicePayeeKind({ cleaningLineCount: 0, inspectionLineCount: 0 })).toBe("CLEANING");
  });
});

describe("payeeKindLabel", () => {
  it("names the person, not one of the two things they did", () => {
    expect(payeeKindLabel("MIXED")).toBe("Cleaner and QA inspector");
  });

  it("keeps the existing wording for the single-kind cases", () => {
    // These two are what the old code produced, so nothing changes on an
    // invoice raised by somebody who only does one job.
    expect(payeeKindLabel("CLEANING")).toBe("Cleaner");
    expect(payeeKindLabel("INSPECTIONS")).toBe("QA inspector");
  });
});

describe("payeeKindFileStem", () => {
  it("keeps the two historical stems byte-for-byte", () => {
    expect(payeeKindFileStem("CLEANING")).toBe("cleaner-invoice");
    expect(payeeKindFileStem("INSPECTIONS")).toBe("qa-inspector-invoice");
  });

  it("gives a mixed invoice a name that claims neither", () => {
    expect(payeeKindFileStem("MIXED")).toBe("payee-invoice");
  });
});

describe("xeroLineFallbackDescription", () => {
  it("follows the LINE's own kind", () => {
    // The actual defect: one label was applied across a whole bill, so a mixed
    // invoice described every line as the wrong sort of work.
    expect(xeroLineFallbackDescription("INSPECTION")).toBe("QA inspection services");
    expect(xeroLineFallbackDescription("CLEANING")).toBe("Cleaning services");
  });
});

describe("payeeKindFromSnapshot", () => {
  it("interprets a historical bare Role rather than rewriting it", () => {
    // The snapshot is the document that was actually sent. Migrating it would
    // change something somebody already holds.
    expect(payeeKindFromSnapshot("QA_INSPECTOR")).toBe("INSPECTIONS");
    expect(payeeKindFromSnapshot("CLEANER")).toBe("CLEANING");
  });

  it("round-trips a value written by the new code", () => {
    for (const kind of ["CLEANING", "INSPECTIONS", "MIXED"] as const) {
      expect(payeeKindFromSnapshot(kind)).toBe(kind);
    }
  });

  it("falls back to CLEANING for anything unrecognised, as the old code did", () => {
    expect(payeeKindFromSnapshot(null)).toBe("CLEANING");
    expect(payeeKindFromSnapshot(undefined)).toBe("CLEANING");
    expect(payeeKindFromSnapshot("")).toBe("CLEANING");
    expect(payeeKindFromSnapshot("BOGUS")).toBe("CLEANING");
  });
});
