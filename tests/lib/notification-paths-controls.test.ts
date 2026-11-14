// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ find: vi.fn(), upsert: vi.fn(), audit: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/db", () => {
  const tx = { $executeRaw: m.lock, appSetting: { findUnique: m.find, upsert: m.upsert }, auditLog: { create: m.audit } };
  return { db: { appSetting: { findUnique: m.find }, $transaction: (run: (client: typeof tx) => unknown) => run(tx) } };
});

import { directPathBanners, outboxTransportsFromEnv, transportPath } from "@/lib/notifications/transport-paths";
import { enabledIntentProviderTransports } from "@/lib/notifications/intent-provider";
import { fallbackTypes } from "@/lib/notifications/catalog";
import {
  getNotificationTypeControls, isTransportSwitchedOff, sanitizeTypeControls, saveNotificationTypeControls, typeRespectsPreferences,
  TypeControlsConflictError,
} from "@/lib/notifications/type-controls";
import { settingsHref, SETTINGS_DESTINATIONS } from "@/components/v2/admin/settings/settings-catalog";

describe("transport paths", () => {
  it("reads the outbox switch exactly like the pipeline dispatcher", () => {
    for (const value of ["", "EMAIL", " EMAIL , WEB_PUSH ", "SMS,BOGUS", "INBOX"]) {
      vi.stubEnv("SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS", value);
      expect(outboxTransportsFromEnv()).toEqual(enabledIntentProviderTransports());
    }
    vi.unstubAllEnvs();
  });

  it("uses the direct path by default and shows a banner for it", () => {
    const env = {};
    expect(transportPath("EMAIL", env)).toBe("direct");
    const banners = directPathBanners(fallbackTypes(), env);
    const reminder = banners.filter((banner) => banner.typeKey === "job.reminder.manual");
    expect(reminder.map((banner) => banner.transport).sort()).toEqual(["EMAIL", "WEB_PUSH"]);
    expect(reminder.find((banner) => banner.transport === "EMAIL")?.message).toMatch(/email is using the direct path because the outbox email transport is switched off.*SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS/);
  });

  it("shows no banner once the transports are on the pipeline", () => {
    const env = { SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS: "EMAIL,WEB_PUSH,SMS" };
    expect(transportPath("WEB_PUSH", env)).toBe("pipeline");
    expect(directPathBanners(fallbackTypes(), env)).toEqual([]);
  });
});

describe("per-type controls default to the behaviour before they existed", () => {
  it("manual reminders ignore personal preferences and no transport is switched off", async () => {
    m.find.mockResolvedValue(null);
    const controls = await getNotificationTypeControls();
    expect(typeRespectsPreferences(controls, "job.reminder.manual")).toBe(false);
    expect(isTransportSwitchedOff(controls, "job.reminder.manual", "EMAIL")).toBe(false);
    expect(controls.updatedAt).toBeNull();
  });

  it("drops unknown types, non-switchable types and transports a type cannot use", () => {
    expect(sanitizeTypeControls({
      respectsPreferences: { "job.reminder.manual": true, "job.offer": true, nope: true },
      disabledTransports: { "job.reminder.manual": ["EMAIL", "SMS", "FAX"], "job.offer": ["EMAIL"] },
    })).toEqual({ respectsPreferences: { "job.reminder.manual": true }, disabledTransports: { "job.reminder.manual": ["EMAIL"] } });
    expect(sanitizeTypeControls("garbage")).toEqual({ respectsPreferences: {}, disabledTransports: {} });
  });

  it("refuses a save over a row changed since it was loaded, and audits a good save", async () => {
    m.find.mockResolvedValue({ value: {}, updatedAt: new Date("2026-11-11T00:00:00.000Z") });
    await expect(saveNotificationTypeControls("admin-1", { expectedUpdatedAt: null, respectsPreferences: { "job.reminder.manual": true } })).rejects.toBeInstanceOf(TypeControlsConflictError);
    m.upsert.mockResolvedValue({ updatedAt: new Date("2026-11-11T01:00:00.000Z") });
    const saved = await saveNotificationTypeControls("admin-1", { expectedUpdatedAt: "2026-11-11T00:00:00.000Z", respectsPreferences: { "job.reminder.manual": true } });
    expect(saved.respectsPreferences).toEqual({ "job.reminder.manual": true });
    expect(m.audit.mock.calls[0][0].data).toMatchObject({ userId: "admin-1", action: "NOTIFICATION_TYPE_CONTROLS_UPDATED", before: { respectsPreferences: {} } });
  });
});

describe("settings catalog points at the notifications area without breaking old URLs", () => {
  it("keeps every old notification settings tab URL and adds the area", () => {
    for (const key of ["notifications", "message-channels", "finance-notifications", "notification-tools"]) {
      expect(settingsHref(key)).toBe(`/v2/admin/settings?tab=${key}`);
    }
    expect(settingsHref("notifications-area")).toBe("/v2/admin/notifications");
    expect(SETTINGS_DESTINATIONS.find((item) => item.key === "notifications-area")).toMatchObject({ group: "notifications", adminOnly: false });
  });
});
