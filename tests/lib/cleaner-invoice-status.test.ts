import { describe, it, expect } from "vitest";
import {
  clearsChangesNote,
  clearsPaymentRecord,
  releasesPayeeWork,
  requiresChangesNote,
} from "@/lib/cleaner/invoice-status";

const ALL = [
  "SENDING",
  "SUBMITTED",
  "CHANGES_REQUESTED",
  "XERO_PUSHED",
  "PAID_CLAIMED",
  "PAID",
  "VOID",
] as const;

describe("releasesPayeeWork", () => {
  it("frees the work on BOTH cancelling states", () => {
    // A void ends the invoice; a send-back asks for a better one. Either way the
    // payee cannot rebuild while every line is still stamped as already billed.
    expect(releasesPayeeWork("VOID")).toBe(true);
    expect(releasesPayeeWork("CHANGES_REQUESTED")).toBe(true);
  });

  it("NEVER releases while the invoice is still live", () => {
    // Releasing here would let the same work be billed on a second invoice
    // while this one is still heading for payment.
    for (const status of ["SENDING", "SUBMITTED", "XERO_PUSHED", "PAID_CLAIMED", "PAID"]) {
      expect(releasesPayeeWork(status), status).toBe(false);
    }
  });

  it("refuses an unknown status rather than defaulting to release", () => {
    expect(releasesPayeeWork("BOGUS")).toBe(false);
    expect(releasesPayeeWork("")).toBe(false);
  });
});

describe("clearsPaymentRecord", () => {
  it("clears only on an explicit reversal", () => {
    expect(clearsPaymentRecord("VOID")).toBe(true);
    expect(clearsPaymentRecord("SUBMITTED")).toBe(true);
    expect(clearsPaymentRecord("CHANGES_REQUESTED")).toBe(true);
  });

  it("NEVER erases the payment record as a side effect", () => {
    // This once caught every non-PAID status, so moving a paid invoice to a
    // state with nothing to do with payment silently deleted when it was paid,
    // how much, by what method and into which account — the audit trail for
    // money that actually left the business.
    for (const status of ["XERO_PUSHED", "PAID_CLAIMED", "PAID", "SENDING"]) {
      expect(clearsPaymentRecord(status), status).toBe(false);
    }
  });
});

describe("requiresChangesNote", () => {
  it("demands a reason only when sending an invoice back", () => {
    expect(requiresChangesNote("CHANGES_REQUESTED")).toBe(true);
    for (const status of ALL.filter((s) => s !== "CHANGES_REQUESTED")) {
      expect(requiresChangesNote(status), status).toBe(false);
    }
  });
});

describe("clearsChangesNote", () => {
  it("keeps the note while the invoice is sitting with the payee", () => {
    expect(clearsChangesNote("CHANGES_REQUESTED")).toBe(false);
  });

  it("clears it once the invoice moves on", () => {
    // A resubmitted or paid invoice still showing last round's note reads as a
    // request that was never actioned.
    for (const status of ALL.filter((s) => s !== "CHANGES_REQUESTED")) {
      expect(clearsChangesNote(status), status).toBe(true);
    }
  });
});

describe("the rules together", () => {
  it("treats a send-back as a cancel for the work but not for the invoice", () => {
    // The whole point of CHANGES_REQUESTED: it behaves like a void toward the
    // work, and unlike a void toward the invoice — which stays, carrying the
    // reason it came back.
    expect(releasesPayeeWork("CHANGES_REQUESTED")).toBe(releasesPayeeWork("VOID"));
    expect(clearsChangesNote("CHANGES_REQUESTED")).not.toBe(clearsChangesNote("VOID"));
  });

  it("never releases work without also clearing any payment record", () => {
    // A released invoice still claiming to have been paid would show the payee
    // as settled for work they are about to re-bill.
    for (const status of ALL) {
      if (releasesPayeeWork(status)) {
        expect(clearsPaymentRecord(status), status).toBe(true);
      }
    }
  });
});
