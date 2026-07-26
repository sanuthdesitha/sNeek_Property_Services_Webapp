import { describe, it, expect } from "vitest";
import { resolveRectificationPayee } from "@/lib/accountability/rectification";

const QA = "qa-inspector-1";
const OTHER_QA = "qa-inspector-2";
const ADMIN = "admin-1";

describe("resolveRectificationPayee — who is credited for QA rectification work", () => {
  it("QA self-rework: the inspector doing it themselves is credited", () => {
    expect(
      resolveRectificationPayee({
        issueRaisedById: QA,
        sessionUserId: QA,
        sessionRole: "QA_INSPECTOR",
      })
    ).toEqual({ payeeUserId: QA, source: "SESSION_QA" });
  });

  it("ADMIN recording the fix credits the QA who raised the issue — NOT the admin", () => {
    // The regression: the admin Quality workspace never sends rectifiedById, so
    // the old `?? session.user.id` fallback paid the signed-in admin.
    const result = resolveRectificationPayee({
      issueRaisedById: QA,
      sessionUserId: ADMIN,
      sessionRole: "ADMIN",
    });
    expect(result.payeeUserId).toBe(QA);
    expect(result.payeeUserId).not.toBe(ADMIN);
    expect(result.source).toBe("ISSUE_RAISER");
  });

  it("OPS_MANAGER recording the fix likewise credits the QA, not themselves", () => {
    expect(
      resolveRectificationPayee({
        issueRaisedById: QA,
        sessionUserId: "ops-1",
        sessionRole: "OPS_MANAGER",
      }).payeeUserId
    ).toBe(QA);
  });

  it("transfer between two inspectors: the recorded rectifier beats the raiser", () => {
    // Inspector A raised it; inspector B actually redid the work and is already
    // recorded on the issue. B gets paid.
    expect(
      resolveRectificationPayee({
        issueRaisedById: QA,
        issueRectifiedById: OTHER_QA,
        sessionUserId: ADMIN,
        sessionRole: "ADMIN",
      })
    ).toEqual({ payeeUserId: OTHER_QA, source: "ISSUE_RECTIFIER" });
  });

  it("an explicit admin choice wins over everything", () => {
    expect(
      resolveRectificationPayee({
        explicitRectifiedById: OTHER_QA,
        issueRectifiedById: QA,
        issueRaisedById: QA,
        sessionUserId: ADMIN,
        sessionRole: "ADMIN",
      })
    ).toEqual({ payeeUserId: OTHER_QA, source: "EXPLICIT" });
  });

  it("a recorded rectifier wins over a QA session (re-deciding someone else's fix)", () => {
    expect(
      resolveRectificationPayee({
        issueRectifiedById: OTHER_QA,
        issueRaisedById: QA,
        sessionUserId: QA,
        sessionRole: "QA_INSPECTOR",
      })
    ).toEqual({ payeeUserId: OTHER_QA, source: "ISSUE_RECTIFIER" });
  });

  it("resolves to nobody when there is no QA to credit — caller must create NO pay", () => {
    expect(
      resolveRectificationPayee({
        sessionUserId: ADMIN,
        sessionRole: "ADMIN",
      })
    ).toEqual({ payeeUserId: null, source: "UNRESOLVED" });
  });

  it("ignores blank / whitespace ids rather than crediting an empty user", () => {
    expect(
      resolveRectificationPayee({
        explicitRectifiedById: "   ",
        issueRectifiedById: "",
        issueRaisedById: QA,
        sessionUserId: ADMIN,
        sessionRole: "ADMIN",
      })
    ).toEqual({ payeeUserId: QA, source: "ISSUE_RAISER" });
  });
});
