// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const rows = new Map<string, unknown>();
  const audits: Array<{ data: Record<string, unknown> }> = [];
  const appSetting = {
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (rows.has(where.key) ? { value: rows.get(where.key) } : null)),
    upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: { value: unknown }; update: { value: unknown } }) => {
      rows.set(where.key, rows.has(where.key) ? update.value : create.value);
      return {};
    }),
  };
  const tx = { $executeRaw: vi.fn(async () => 0), appSetting, auditLog: { create: vi.fn(async (input: { data: Record<string, unknown> }) => { audits.push(input); return {}; }) } };
  return { rows, audits, appSetting, tx, saveSettings: vi.fn(), settings: { emailTemplates: {} as Record<string, { subject: string; html: string }> } };
});

vi.mock("@/lib/db", () => ({ db: { appSetting: m.appSetting, $transaction: async (fn: (tx: unknown) => unknown) => fn(m.tx) } }));
vi.mock("@/lib/settings", async () => {
  const { getDefaultEmailTemplates } = await import("@/lib/email-templates");
  const settings = () => ({ companyName: "sNeek", logoUrl: "", timezone: "Australia/Sydney", emailTemplates: { ...getDefaultEmailTemplates(), ...m.settings.emailTemplates } });
  return {
    getAppSettings: async () => settings(),
    getTransactionAppSettings: async () => settings(),
    saveAppSettings: async (patch: { emailTemplates: Record<string, { subject: string; html: string }> }) => {
      m.saveSettings(patch);
      m.settings.emailTemplates = patch.emailTemplates;
      return settings();
    },
  };
});

import { saveWording, WordingConflictError, WordingInvalidError, wordingRowKey } from "@/lib/notifications/wording/store";
import { loadNotificationWording, renderNotificationWording } from "@/lib/notifications/wording/render";
import { readTypeWording } from "@/lib/notifications/wording/read";
import { wordingHash } from "@/lib/notifications/wording/template";
import { wordingPart } from "@/lib/notifications/wording/registry";

const actor = { id: "admin-1", name: "Hannah Lee", role: "ADMIN" };
const defaultHash = (typeKey: string, part: string, transport: "INBOX" | "EMAIL" | "SMS") => wordingHash(wordingPart(typeKey, part, transport)!.defaults);

beforeEach(() => {
  m.rows.clear();
  m.audits.length = 0;
  m.settings.emailTemplates = {};
  vi.clearAllMocks();
});

describe("saving versions", () => {
  it("saves v2, audits before, after, actor and role, and every send path then uses it", async () => {
    const saved = await saveWording({ typeKey: "job.cancelled", partId: "cleaner", transport: "INBOX", kind: "EDIT", fields: { title: "Shift off", body: "{{propertyName}} is off. Why: {{reason}}" }, expectedHash: defaultHash("job.cancelled", "cleaner", "INBOX"), actor, change: "Shorter" });
    expect(saved.version).toBe(2);
    expect(m.audits[0].data).toMatchObject({ userId: "admin-1", action: "NOTIFICATION_WORDING_UPDATED", entityId: wordingRowKey("job.cancelled") });
    expect(m.audits[0].data.before).toMatchObject({ fields: { title: "Job cancelled" } });
    expect(m.audits[0].data.after).toMatchObject({ version: 2, actorRole: "ADMIN", fields: { title: "Shift off" }, change: "Shorter" });
    const rendered = await renderNotificationWording("job.cancelled", "INBOX", { propertyName: "Manly Loft", reason: "Owner" });
    expect(rendered).toMatchObject({ title: "Shift off", body: "Manly Loft is off. Why: Owner", source: "override" });
  });

  it("refuses a stale write with 409 and keeps the newer version", async () => {
    const first = await saveWording({ typeKey: "job.cancelled", partId: "cleaner", transport: "INBOX", kind: "EDIT", fields: { title: "A", body: "{{propertyName}} {{reason}}" }, expectedHash: defaultHash("job.cancelled", "cleaner", "INBOX"), actor });
    await expect(saveWording({ typeKey: "job.cancelled", partId: "cleaner", transport: "INBOX", kind: "EDIT", fields: { title: "B", body: "{{propertyName}} {{reason}}" }, expectedHash: defaultHash("job.cancelled", "cleaner", "INBOX"), actor })).rejects.toBeInstanceOf(WordingConflictError);
    expect(first.version).toBe(2);
    expect((await readTypeWording("job.cancelled"))!.parts[0].live.title).toBe("A");
  });

  it("refuses wording that drops a required variable or uses an unknown one (400), saving nothing", async () => {
    const hash = defaultHash("job.reminder.scheduled", "cleaner", "SMS");
    await expect(saveWording({ typeKey: "job.reminder.scheduled", partId: "cleaner", transport: "SMS", kind: "EDIT", fields: { body: "Job at {{propertyName}} soon" }, expectedHash: hash, actor })).rejects.toBeInstanceOf(WordingInvalidError);
    await expect(saveWording({ typeKey: "job.reminder.scheduled", partId: "cleaner", transport: "SMS", kind: "EDIT", fields: { body: "{{propertyName}} {{when}} {{password}}" }, expectedHash: hash, actor })).rejects.toThrow(/not a variable/);
    expect(m.rows.size).toBe(0);
    expect(m.audits).toHaveLength(0);
  });

  it("restores an older version and resets to the default, each as a new version", async () => {
    const typeKey = "job.reminder.scheduled";
    let hash = defaultHash(typeKey, "cleaner", "SMS");
    const v2 = await saveWording({ typeKey, partId: "cleaner", transport: "SMS", kind: "EDIT", fields: { body: "v2 {{propertyName}} {{when}}" }, expectedHash: hash, actor });
    const v3 = await saveWording({ typeKey, partId: "cleaner", transport: "SMS", kind: "EDIT", fields: { body: "v3 {{propertyName}} {{when}}" }, expectedHash: v2.hash, actor });
    const v4 = await saveWording({ typeKey, partId: "cleaner", transport: "SMS", kind: "RESTORE", restoreVersion: 2, expectedHash: v3.hash, actor });
    expect(v4.version).toBe(4);
    let view = await readTypeWording(typeKey);
    expect(view!.parts.find((part) => part.transport === "SMS" && part.id === "cleaner")!.live.body).toBe("v2 {{propertyName}} {{when}}");
    hash = v4.hash;
    const v5 = await saveWording({ typeKey, partId: "cleaner", transport: "SMS", kind: "RESET", expectedHash: hash, actor });
    view = await readTypeWording(typeKey);
    const sms = view!.parts.find((part) => part.transport === "SMS" && part.id === "cleaner")!;
    expect([v5.version, sms.liveSource, sms.versions.map((version) => version.version)]).toEqual([5, "default", [1, 2, 3, 4, 5]]);
  });

  it("an email-template part writes the shared template (Forms sees it) in its own syntax and keeps the history here", async () => {
    const view = await readTypeWording("job.offer");
    const part = view!.parts[0];
    const saved = await saveWording({ typeKey: "job.offer", partId: "cleaner", transport: "EMAIL", kind: "EDIT", fields: { subject: "New job: {{propertyName}}", body: "<p>Hi {{userName}}</p>" }, expectedHash: part.liveHash, actor });
    expect(m.saveSettings.mock.calls[0][0].emailTemplates.jobAssigned).toEqual({ subject: "New job: {propertyName}", html: "<p>Hi {userName}</p>" });
    const after = (await readTypeWording("job.offer"))!.parts[0];
    expect([after.liveSource, after.live.subject, after.liveHash]).toEqual(["override", "New job: {{propertyName}}", saved.hash]);
    m.settings.emailTemplates = { ...m.settings.emailTemplates, jobAssigned: { subject: "Changed in Forms", html: "<p>x</p>" } };
    expect((await readTypeWording("job.offer"))!.parts[0].liveSource).toBe("forms");
    await expect(saveWording({ typeKey: "job.offer", partId: "cleaner", transport: "EMAIL", kind: "EDIT", fields: { subject: "Mine", body: "<p>y</p>" }, expectedHash: saved.hash, actor })).rejects.toBeInstanceOf(WordingConflictError);
  });
});

describe("rendering overrides", () => {
  it("applies an override on every transport of a type (inbox, email, SMS)", async () => {
    const typeKey = "job.cleaner_day_reminder";
    const inbox = await saveWording({ typeKey, partId: "cleaner", transport: "INBOX", kind: "EDIT", fields: { title: "Today: {{propertyName}}", body: "Be at {{propertyName}} at {{when}}" }, expectedHash: defaultHash(typeKey, "cleaner", "INBOX"), actor });
    await saveWording({ typeKey, partId: "cleaner", transport: "EMAIL", kind: "EDIT", fields: { subject: "Today: {{propertyName}}", body: "<p>{{propertyName}} &middot; {{when}}</p>" }, expectedHash: defaultHash(typeKey, "cleaner", "EMAIL"), actor });
    await saveWording({ typeKey, partId: "cleaner", transport: "SMS", kind: "EDIT", fields: { body: "{{when}}: {{propertyName}}" }, expectedHash: defaultHash(typeKey, "cleaner", "SMS"), actor });
    expect(inbox.version).toBe(2);
    const wording = await loadNotificationWording(typeKey);
    const values = { propertyName: "A&B <Loft>", when: "10:00" };
    expect(wording.render("cleaner", "INBOX", values)).toMatchObject({ title: "Today: A&B <Loft>", body: "Be at A&B <Loft> at 10:00" });
    expect(wording.render("cleaner", "EMAIL", values)).toMatchObject({ subject: "Today: A&B <Loft>", html: "<p>A&amp;B &lt;Loft&gt; &middot; 10:00</p>" });
    expect(wording.render("cleaner", "SMS", values).body).toBe("10:00: A&B <Loft>");
  });

  it("falls back to the default when a stored override is invalid, and when the store cannot be read", async () => {
    m.rows.set(wordingRowKey("job.cancelled"), { entries: { "cleaner:INBOX": [{ version: 2, fields: { title: "Bad", body: "{{nope}}" }, savedAt: "2026-11-01T00:00:00Z", actor, kind: "EDIT", change: "" }] } });
    const invalid = await renderNotificationWording("job.cancelled", "INBOX", { propertyName: "P", day: "D", jobNumber: "J", reason: "R" });
    expect(invalid).toMatchObject({ title: "Job cancelled", source: "default" });
    expect((await readTypeWording("job.cancelled"))!.parts[0].liveSource).toBe("invalid");
    m.appSetting.findUnique.mockRejectedValueOnce(new Error("db down"));
    expect((await renderNotificationWording("job.cancelled", "INBOX", { propertyName: "P", reason: "R" })).title).toBe("Job cancelled");
  });
});
