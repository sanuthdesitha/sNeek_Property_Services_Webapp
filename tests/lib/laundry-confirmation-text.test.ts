import { describe, it, expect } from "vitest";
import { describeLaundryConfirmation } from "@/lib/laundry/media";

/**
 * `LaundryConfirmation.notes` is a JSON envelope the cleaner and driver apps
 * write. The client job page printed it verbatim, so clients saw event keys,
 * S3 object keys and ISO timestamps instead of a sentence.
 *
 * The rule these tests pin: never show the client raw JSON, never show an
 * internal storage key, and never lose a note a human actually typed.
 */

const envelope = (meta: Record<string, unknown>) => ({ id: "c1", notes: JSON.stringify(meta) });

describe("describeLaundryConfirmation", () => {
  it("describes a drop-off with its location", () => {
    const text = describeLaundryConfirmation(
      envelope({
        event: "DROPPED",
        dropoffLocation: "Front door",
        dropoffPhotoKey: "laundry/dropoff/cmmydg57m000010xg99rsorw2/e63f45fe.jpg",
        intendedDropoffDate: "2026-08-15T14:00:00.000Z",
        actualDroppedAt: "2026-08-15T01:36:05.218Z",
      })
    );
    expect(text).toBe("Returned to Front door");
  });

  it("never leaks the S3 key or the ISO timestamps", () => {
    const text = describeLaundryConfirmation(
      envelope({
        event: "DROPPED",
        dropoffLocation: "Front door",
        dropoffPhotoKey: "laundry/dropoff/cmmydg57m000010xg99rsorw2/e63f45fe.jpg",
        actualDroppedAt: "2026-08-15T01:36:05.218Z",
      })
    );
    expect(text).not.toMatch(/laundry\/dropoff/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(text).not.toMatch(/[{}"]/);
  });

  it("adds the early-return reason when there is one", () => {
    expect(
      describeLaundryConfirmation(
        envelope({ event: "DROPPED", dropoffLocation: "Front door", earlyDropoffReason: "In area" })
      )
    ).toBe("Returned to Front door · Returned early — In area");
  });

  it("describes a pickup with its bag count, pluralised", () => {
    expect(describeLaundryConfirmation(envelope({ event: "PICKED_UP", bagCount: 1 }))).toBe(
      "Picked up — 1 bag"
    );
    expect(describeLaundryConfirmation(envelope({ event: "PICKED_UP", bagCount: 3 }))).toBe(
      "Picked up — 3 bags"
    );
  });

  it("describes the early-update envelope, which carries an outcome not an event", () => {
    expect(
      describeLaundryConfirmation(
        envelope({ source: "EARLY_UPDATE", laundryOutcome: "READY_FOR_PICKUP", reasonNote: null })
      )
    ).toBe("Marked ready for pickup");
  });

  it("keeps a human note that travelled inside the envelope", () => {
    expect(
      describeLaundryConfirmation(
        envelope({ source: "EARLY_UPDATE", laundryOutcome: "NOT_READY", reasonNote: "Dryer broken" })
      )
    ).toBe("Marked not ready · Dryer broken");
  });

  it("passes plain typed text through untouched", () => {
    // A note that is not JSON was written by a person and is already readable.
    expect(describeLaundryConfirmation({ id: "c1", notes: "Left with concierge" })).toBe(
      "Left with concierge"
    );
  });

  it("returns null when there is nothing worth saying", () => {
    // Callers omit the line entirely rather than rendering an empty paragraph.
    expect(describeLaundryConfirmation({ id: "c1", notes: null })).toBeNull();
    expect(describeLaundryConfirmation({ id: "c1", notes: "" })).toBeNull();
    expect(describeLaundryConfirmation(envelope({ event: "SOMETHING_NEW" }))).toBeNull();
  });
});
