import { describe, it, expect } from "vitest";
import {
  buildPropertyAccessInfo,
  pickLegacyAccessCode,
  resolvePropertyAccessCode,
} from "@/lib/properties/access-info";

/**
 * Regression cover for the laundry-allocation data loss: the v2 property detail
 * PATCHes only the access text fields, and rebuilding accessInfo from the body
 * alone reset laundryTeamUserIds/attachments to [] on every save.
 */
const STORED = {
  lockbox: "Key safe left of door",
  codes: "1234#",
  parking: "Visitor bay 3",
  other: "",
  instructions: "Use the side gate",
  laundryTeamUserIds: ["clx0000laundryuser1", "clx0000laundryuser2"],
  attachments: [{ name: "gate.jpg", url: "https://example.test/gate.jpg" }],
  defaultCleanDurationHours: 3,
  maxGuestCount: 4,
};

describe("buildPropertyAccessInfo", () => {
  it("preserves keys the request does not send", () => {
    const result = buildPropertyAccessInfo(
      { accessInfo: { lockbox: "Key safe left of door", codes: "1234#" } },
      STORED
    );
    expect(result.laundryTeamUserIds).toEqual(["clx0000laundryuser1", "clx0000laundryuser2"]);
    expect(result.attachments).toEqual([{ name: "gate.jpg", url: "https://example.test/gate.jpg" }]);
    expect(result.defaultCleanDurationHours).toBe(3);
    expect(result.maxGuestCount).toBe(4);
  });

  it("applies an explicit laundry team change", () => {
    const result = buildPropertyAccessInfo(
      { accessInfo: { laundryTeamUserIds: ["clx0000laundryuser3"] } },
      STORED
    );
    expect(result.laundryTeamUserIds).toEqual(["clx0000laundryuser3"]);
  });

  it("lets an explicit empty array clear the laundry team", () => {
    const result = buildPropertyAccessInfo({ accessInfo: { laundryTeamUserIds: [] } }, STORED);
    expect(result.laundryTeamUserIds).toEqual([]);
  });

  it("lets an explicit empty string clear a text field", () => {
    const result = buildPropertyAccessInfo({ accessInfo: { parking: "" } }, STORED);
    expect(result.parking).toBe("");
    expect(result.lockbox).toBe("Key safe left of door");
  });

  it("defaults to empty collections on create, when nothing is stored", () => {
    const result = buildPropertyAccessInfo({ accessInfo: { lockbox: " Front desk " } });
    expect(result.lockbox).toBe("Front desk");
    expect(result.laundryTeamUserIds).toEqual([]);
    expect(result.attachments).toEqual([]);
  });

  it("drops blank and non-string laundry user ids", () => {
    const result = buildPropertyAccessInfo(
      { accessInfo: { laundryTeamUserIds: ["clx0000laundryuser1", "  ", 42, null] } },
      STORED
    );
    expect(result.laundryTeamUserIds).toEqual(["clx0000laundryuser1"]);
  });

  it("prefers the flat keyLocation column over the stored JSON", () => {
    const result = buildPropertyAccessInfo(
      { accessCode: " 9999# ", keyLocation: " Concierge ", accessInfo: {} },
      STORED
    );
    expect(result.lockbox).toBe("Concierge");
  });

  it("summarises access notes from the request note, instructions and other", () => {
    const result = buildPropertyAccessInfo(
      { accessNotes: "Ring first", accessInfo: { instructions: "Side gate", other: "Dog on site" } },
      STORED
    );
    expect(result.accessNotesSummary).toBe("Ring first\n\nSide gate\n\nDog on site");
  });

  it("ignores a non-object stored value", () => {
    const result = buildPropertyAccessInfo({ accessInfo: { parking: "Bay 1" } }, "corrupt");
    expect(result.parking).toBe("Bay 1");
    expect(result.laundryTeamUserIds).toEqual([]);
  });

  /**
   * The door code belongs in the encrypted Property.accessCode column alone.
   * It used to be copied into accessInfo.codes as plain JSON, so every save
   * must now scrub the key rather than merge it forward.
   */
  it("never writes the door code into the JSON, from either input field", () => {
    const fromFlatField = buildPropertyAccessInfo({ accessCode: "9999#", accessInfo: {} });
    const fromJson = buildPropertyAccessInfo({ accessInfo: { codes: "1111" } });
    expect(fromFlatField).not.toHaveProperty("codes");
    expect(fromJson).not.toHaveProperty("codes");
  });

  it("scrubs a stored plaintext code on any save that touches the row", () => {
    expect(STORED.codes).toBe("1234#"); // guards the fixture against drift
    const result = buildPropertyAccessInfo({ accessInfo: { parking: "Visitor bay 4" } }, STORED);
    expect(result).not.toHaveProperty("codes");
    // The scrub must not cost the caller anything else it did not send.
    expect(result.laundryTeamUserIds).toEqual(["clx0000laundryuser1", "clx0000laundryuser2"]);
    expect(result.lockbox).toBe("Key safe left of door");
  });
});

describe("pickLegacyAccessCode", () => {
  it("reads a legacy plaintext code out of stored JSON", () => {
    expect(pickLegacyAccessCode({ codes: " 1234# " })).toBe("1234#");
  });

  it("returns null once the row has been scrubbed", () => {
    expect(pickLegacyAccessCode({ lockbox: "Front desk" })).toBeNull();
    expect(pickLegacyAccessCode({ codes: "   " })).toBeNull();
    expect(pickLegacyAccessCode(null)).toBeNull();
    expect(pickLegacyAccessCode("corrupt")).toBeNull();
  });
});

describe("resolvePropertyAccessCode", () => {
  it("prefers the flat accessCode field", () => {
    expect(resolvePropertyAccessCode({ accessCode: " 9999# ", accessInfo: { codes: "1111" } })).toBe(
      "9999#"
    );
  });

  it("falls back to the legacy JSON so a JSON-only code is not blanked", () => {
    expect(resolvePropertyAccessCode({ accessInfo: { codes: " 1111 " } })).toBe("1111");
  });

  it("reads the stored JSON when the request carries no code at all", () => {
    expect(resolvePropertyAccessCode({}, STORED)).toBe("1234#");
  });

  it("returns an empty string when no code is available anywhere", () => {
    expect(resolvePropertyAccessCode({ accessInfo: {} })).toBe("");
  });
});
