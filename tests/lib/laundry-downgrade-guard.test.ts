import { describe, it, expect } from "vitest";
import { LaundryStatus } from "@prisma/client";
import { blocksLaundryFinalSubmissionDowngrade } from "@/lib/laundry/cleaner-status";

describe("blocksLaundryFinalSubmissionDowngrade", () => {
  it("blocks a final submission from undoing a confirmed-and-notified pickup", () => {
    expect(
      blocksLaundryFinalSubmissionDowngrade(
        { status: LaundryStatus.CONFIRMED, notifyLaundry: true },
        "FINAL_SUBMISSION"
      )
    ).toBe(true);
  });

  it("allows an explicit early-update correction to downgrade", () => {
    expect(
      blocksLaundryFinalSubmissionDowngrade(
        { status: LaundryStatus.CONFIRMED, notifyLaundry: true },
        "EARLY_UPDATE"
      )
    ).toBe(false);
  });

  it("does not block when partners were never notified", () => {
    expect(
      blocksLaundryFinalSubmissionDowngrade(
        { status: LaundryStatus.CONFIRMED, notifyLaundry: false },
        "FINAL_SUBMISSION"
      )
    ).toBe(false);
    expect(
      blocksLaundryFinalSubmissionDowngrade(
        { status: LaundryStatus.PENDING, notifyLaundry: null },
        "FINAL_SUBMISSION"
      )
    ).toBe(false);
    expect(
      blocksLaundryFinalSubmissionDowngrade(
        { status: LaundryStatus.FLAGGED, notifyLaundry: false },
        "FINAL_SUBMISSION"
      )
    ).toBe(false);
  });
});
