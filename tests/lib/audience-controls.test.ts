import { describe, it, expect } from "vitest";
import {
  DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS,
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_AUDIENCE_KEYS,
  audienceForRole,
  isChannelAllowed,
  sanitizeNotificationAudienceControls,
  type NotificationAudienceControls,
} from "@/lib/notifications/audience-controls";

describe("DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS", () => {
  it("has every channel and every audience on by default", () => {
    const d = DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS;
    expect(d.channels).toEqual({ email: true, sms: true, push: true });
    for (const key of NOTIFICATION_AUDIENCE_KEYS) {
      expect(d.audiences[key]).toEqual({ email: true, sms: true, push: true });
    }
  });

  it("covers all 7 declared audiences", () => {
    expect(NOTIFICATION_AUDIENCES.map((a) => a.key)).toEqual([
      "CLIENT",
      "CLEANER",
      "LAUNDRY",
      "MAINTENANCE",
      "QA",
      "STAFF_ADMIN",
      "PUBLIC",
    ]);
  });
});

describe("sanitizeNotificationAudienceControls", () => {
  it("round-trips the all-on default", () => {
    const out = sanitizeNotificationAudienceControls(DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS);
    expect(out).toEqual(DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS);
  });

  it("returns all-on for garbage / non-object input", () => {
    for (const garbage of [null, undefined, 42, "nope", [], true]) {
      const out = sanitizeNotificationAudienceControls(garbage);
      expect(out).toEqual(DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS);
    }
  });

  it("clamps partial input and backfills unknown audiences to on", () => {
    const out = sanitizeNotificationAudienceControls({
      channels: { email: false },
      audiences: { CLIENT: { sms: false } },
    });
    // Missing channel booleans fall back to on; explicit false is kept.
    expect(out.channels).toEqual({ email: false, sms: true, push: true });
    // Explicit false kept, missing fields backfilled to on.
    expect(out.audiences.CLIENT).toEqual({ email: true, sms: false, push: true });
    // Untouched audiences default to all-on.
    expect(out.audiences.CLEANER).toEqual({ email: true, sms: true, push: true });
    expect(out.audiences.PUBLIC).toEqual({ email: true, sms: true, push: true });
  });

  it("ignores non-boolean toggle values", () => {
    const out = sanitizeNotificationAudienceControls({
      channels: { email: "false", sms: 0, push: null },
      audiences: { QA: { email: "no", sms: 1, push: false } },
    });
    expect(out.channels).toEqual({ email: true, sms: true, push: true });
    expect(out.audiences.QA).toEqual({ email: true, sms: true, push: false });
  });

  it("ignores unknown audience keys in input", () => {
    const out = sanitizeNotificationAudienceControls({
      audiences: { NOT_A_REAL_AUDIENCE: { email: false } },
    });
    expect(out).toEqual(DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS);
    expect((out.audiences as Record<string, unknown>).NOT_A_REAL_AUDIENCE).toBeUndefined();
  });
});

describe("audienceForRole", () => {
  it("maps known roles to their audiences", () => {
    expect(audienceForRole("CLIENT")).toBe("CLIENT");
    expect(audienceForRole("CLEANER")).toBe("CLEANER");
    expect(audienceForRole("LAUNDRY")).toBe("LAUNDRY");
    expect(audienceForRole("MAINTENANCE")).toBe("MAINTENANCE");
    expect(audienceForRole("QA_INSPECTOR")).toBe("QA");
    expect(audienceForRole("ADMIN")).toBe("STAFF_ADMIN");
    expect(audienceForRole("OPS_MANAGER")).toBe("STAFF_ADMIN");
  });

  it("maps null / undefined / unknown to PUBLIC", () => {
    expect(audienceForRole(null)).toBe("PUBLIC");
    expect(audienceForRole(undefined)).toBe("PUBLIC");
    expect(audienceForRole("")).toBe("PUBLIC");
    expect(audienceForRole("SOME_FUTURE_ROLE")).toBe("PUBLIC");
    expect(audienceForRole("client")).toBe("PUBLIC"); // case-sensitive on the enum value
  });
});

describe("isChannelAllowed", () => {
  it("returns true when controls are undefined (fail-open)", () => {
    expect(isChannelAllowed(undefined, "CLIENT", "email")).toBe(true);
    expect(isChannelAllowed(undefined, "PUBLIC", "sms")).toBe(true);
  });

  it("allows everything under the all-on default", () => {
    for (const key of NOTIFICATION_AUDIENCE_KEYS) {
      for (const ch of ["email", "sms", "push"] as const) {
        expect(isChannelAllowed(DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS, key, ch)).toBe(true);
      }
    }
  });

  it("global master off beats an audience toggle that is on", () => {
    const controls: NotificationAudienceControls = {
      channels: { email: false, sms: true, push: true },
      audiences: {
        ...DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS.audiences,
        CLIENT: { email: true, sms: true, push: true },
      },
    };
    expect(isChannelAllowed(controls, "CLIENT", "email")).toBe(false);
    // Other channels for the same audience unaffected.
    expect(isChannelAllowed(controls, "CLIENT", "sms")).toBe(true);
    expect(isChannelAllowed(controls, "CLIENT", "push")).toBe(true);
  });

  it("audience toggle off blocks even when the global master is on", () => {
    const controls: NotificationAudienceControls = {
      channels: { email: true, sms: true, push: true },
      audiences: {
        ...DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS.audiences,
        CLEANER: { email: true, sms: false, push: true },
      },
    };
    expect(isChannelAllowed(controls, "CLEANER", "sms")).toBe(false);
    expect(isChannelAllowed(controls, "CLEANER", "email")).toBe(true);
    // A different audience is unaffected.
    expect(isChannelAllowed(controls, "CLIENT", "sms")).toBe(true);
  });

  it("treats each channel independently", () => {
    const controls: NotificationAudienceControls = {
      channels: { email: true, sms: true, push: false },
      audiences: {
        ...DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS.audiences,
        QA: { email: false, sms: true, push: true },
      },
    };
    expect(isChannelAllowed(controls, "QA", "email")).toBe(false); // audience email off
    expect(isChannelAllowed(controls, "QA", "sms")).toBe(true); // both on
    expect(isChannelAllowed(controls, "QA", "push")).toBe(false); // global push off
  });

  it("allows an audience missing from the map (fail-open per-audience)", () => {
    const controls = {
      channels: { email: true, sms: true, push: true },
      audiences: {} as NotificationAudienceControls["audiences"],
    };
    expect(isChannelAllowed(controls, "STAFF_ADMIN", "email")).toBe(true);
  });
});
