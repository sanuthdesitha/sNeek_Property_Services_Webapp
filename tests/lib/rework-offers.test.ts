import { describe, it, expect } from "vitest";
import {
  DEFAULT_REWORK_OFFER_TTL_MINUTES,
  buildOfferWindow,
  effectiveOfferStatus,
  expireOfferPatch,
  isOfferOpen,
  normalizeOfferStatus,
  offerMinutesRemaining,
  offerTtlMs,
} from "@/lib/qa/rework-offers";

const NOW = new Date("2026-07-23T02:00:00.000Z");

describe("normalizeOfferStatus", () => {
  it("accepts the known statuses (case-insensitively)", () => {
    expect(normalizeOfferStatus("offered")).toBe("OFFERED");
    expect(normalizeOfferStatus("ACCEPTED")).toBe("ACCEPTED");
  });
  it("falls back to NONE for junk", () => {
    expect(normalizeOfferStatus(null)).toBe("NONE");
    expect(normalizeOfferStatus("MAYBE")).toBe("NONE");
    expect(normalizeOfferStatus(7)).toBe("NONE");
  });
});

describe("offerTtlMs", () => {
  it("defaults when the setting is missing or invalid", () => {
    expect(offerTtlMs(null)).toBe(DEFAULT_REWORK_OFFER_TTL_MINUTES * 60_000);
    expect(offerTtlMs(0)).toBe(DEFAULT_REWORK_OFFER_TTL_MINUTES * 60_000);
    expect(offerTtlMs(Number.NaN)).toBe(DEFAULT_REWORK_OFFER_TTL_MINUTES * 60_000);
  });
  it("clamps absurd values to a day", () => {
    expect(offerTtlMs(99999)).toBe(24 * 60 * 60_000);
  });
});

describe("buildOfferWindow", () => {
  it("stamps OFFERED with the TTL window", () => {
    const w = buildOfferWindow(NOW, 30);
    expect(w.reworkOfferStatus).toBe("OFFERED");
    expect(w.reworkOfferedAt).toEqual(NOW);
    expect(w.reworkOfferExpiresAt.getTime() - NOW.getTime()).toBe(30 * 60_000);
  });
});

describe("effectiveOfferStatus (defensive expiry on read)", () => {
  it("an open offer inside its window reads OFFERED", () => {
    const w = buildOfferWindow(NOW, 30);
    expect(effectiveOfferStatus(w, new Date(NOW.getTime() + 10 * 60_000))).toBe("OFFERED");
    expect(isOfferOpen(w, new Date(NOW.getTime() + 10 * 60_000))).toBe(true);
  });

  it("a lapsed OFFERED row reads EXPIRED even though nothing wrote it back", () => {
    const w = buildOfferWindow(NOW, 30);
    const later = new Date(NOW.getTime() + 31 * 60_000);
    expect(effectiveOfferStatus(w, later)).toBe("EXPIRED");
    expect(isOfferOpen(w, later)).toBe(false);
  });

  it("expiry is inclusive at the boundary", () => {
    const w = buildOfferWindow(NOW, 30);
    expect(effectiveOfferStatus(w, new Date(NOW.getTime() + 30 * 60_000))).toBe("EXPIRED");
  });

  it("terminal statuses are never re-expired", () => {
    const base = { reworkOfferExpiresAt: new Date(NOW.getTime() - 60_000) };
    expect(effectiveOfferStatus({ ...base, reworkOfferStatus: "ACCEPTED" }, NOW)).toBe("ACCEPTED");
    expect(effectiveOfferStatus({ ...base, reworkOfferStatus: "DECLINED" }, NOW)).toBe("DECLINED");
  });

  it("an OFFERED row with no expiry stays open", () => {
    expect(effectiveOfferStatus({ reworkOfferStatus: "OFFERED", reworkOfferExpiresAt: null }, NOW)).toBe("OFFERED");
  });

  it("accepts ISO strings as well as Dates", () => {
    expect(
      effectiveOfferStatus(
        { reworkOfferStatus: "OFFERED", reworkOfferExpiresAt: new Date(NOW.getTime() - 1).toISOString() },
        NOW
      )
    ).toBe("EXPIRED");
  });
});

describe("offerMinutesRemaining", () => {
  it("reports the remaining minutes on an open offer", () => {
    const w = buildOfferWindow(NOW, 30);
    expect(offerMinutesRemaining(w, new Date(NOW.getTime() + 10 * 60_000))).toBe(20);
  });
  it("is null once the offer is closed", () => {
    const w = buildOfferWindow(NOW, 30);
    expect(offerMinutesRemaining(w, new Date(NOW.getTime() + 45 * 60_000))).toBeNull();
  });
});

describe("expireOfferPatch", () => {
  it("produces the sweep patch only for a lapsed OFFERED row", () => {
    const w = buildOfferWindow(NOW, 30);
    expect(expireOfferPatch(w, new Date(NOW.getTime() + 45 * 60_000))).toEqual({ reworkOfferStatus: "EXPIRED" });
    expect(expireOfferPatch(w, new Date(NOW.getTime() + 5 * 60_000))).toBeNull();
    expect(expireOfferPatch({ reworkOfferStatus: "ACCEPTED" }, NOW)).toBeNull();
  });
});
