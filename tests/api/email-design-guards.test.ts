// @vitest-environment node
/**
 * One place edits each email: the classic settings raw-template editor and
 * the finance template editor can no longer save email HTML for an email that
 * has a block design (resetting to the standard stays allowed), and publishing
 * tells the other administrators by inbox only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ session: vi.fn(), settings: vi.fn(), save: vi.fn(), template: vi.fn(), upsert: vi.fn(), users: vi.fn(), office: vi.fn(), controls: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings");
  return { ...actual, getAppSettings: m.settings, saveAppSettings: m.save, schedulingRuleFieldsChanged: () => [] };
});
vi.mock("@/lib/portal-version-store", () => ({ invalidateDefaultPortalVersion: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  notificationTemplate: { findUnique: m.template, upsert: m.upsert },
  user: { findMany: m.users },
  appSetting: { findUnique: vi.fn(async () => null) },
  auditLog: { create: vi.fn() },
  settingsAudit: { create: vi.fn() },
} }));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: m.office }));
vi.mock("@/lib/notifications/type-controls", () => ({ getNotificationTypeControls: m.controls, typeRespectsPreferences: () => false }));

import { PATCH as SETTINGS_PATCH } from "@/app/api/admin/settings/route";
import { PATCH as TEMPLATE_PATCH } from "@/app/api/admin/notifications/templates/route";
import { getDefaultEmailTemplates } from "@/lib/email-templates";
import { notifyEmailDesignPublished } from "@/lib/email-design/publish-notice";

const patch = (body: unknown) => new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
  m.settings.mockResolvedValue({ emailTemplates: getDefaultEmailTemplates(), companyName: "sNeek" });
  m.save.mockImplementation(async (input: unknown) => input);
  m.controls.mockResolvedValue({ disabledTransports: {} });
  m.office.mockResolvedValue([]);
});

describe("classic settings raw-template editor", () => {
  it("refuses a raw-HTML change to a shared email (409) and saves nothing", async () => {
    const templates = { ...getDefaultEmailTemplates(), jobAssigned: { subject: "Job!", html: "<p>Custom</p>" } };
    const response = await SETTINGS_PATCH(patch({ emailTemplates: templates }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("jobAssigned");
    expect(m.save).not.toHaveBeenCalled();
  });

  it("still allows putting the standard back, and saves that do not touch emails", async () => {
    m.settings.mockResolvedValue({ emailTemplates: { ...getDefaultEmailTemplates(), jobAssigned: { subject: "Old custom", html: "<p>x</p>" } }, companyName: "sNeek" });
    const response = await SETTINGS_PATCH(patch({ emailTemplates: getDefaultEmailTemplates() }));
    expect(response.status).toBe(200);
    expect(m.save).toHaveBeenCalled();
  });
});

describe("finance template editor", () => {
  it("refuses new email HTML (the email is an Email design) but keeps SMS and push editable", async () => {
    m.template.mockResolvedValue({ emailSubject: "Invoice {{invoiceNumber}}", emailBodyHtml: null });
    const refused = await TEMPLATE_PATCH(patch({ eventKey: "invoice_overdue", emailBodyHtml: "<p>New</p>" }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).href).toContain("email=finance.invoice_overdue");
    expect(m.upsert).not.toHaveBeenCalled();
    m.upsert.mockResolvedValue({});
    const sms = await TEMPLATE_PATCH(patch({ eventKey: "invoice_overdue", smsBody: "Overdue {{invoiceNumber}}", emailBodyHtml: null }));
    expect(sms.status).toBe(200);
  });
});

describe("publish notice", () => {
  it("goes to the other active administrators, inbox only, one event per version", async () => {
    m.users.mockResolvedValue([{ id: "admin-2", role: "ADMIN", name: "Ravi", email: "r@example.invalid" }]);
    await notifyEmailDesignPublished({ key: "jobReminder24h", label: "Job reminder (24 hours)", typeKey: "job.reminder.scheduled", version: 6, change: "Subject changed", actor: { id: "admin-1", name: "Hannah" } });
    expect(m.users.mock.calls[0][0]).toMatchObject({ where: { isActive: true, role: "ADMIN", id: { not: "admin-1" } } });
    const input = m.office.mock.calls[0][0];
    expect(input).toMatchObject({ typeKey: "email.design_published", transports: ["INBOX"], scopeType: "STAFF_MEMBER", eventId: "email-design-published:jobReminder24h:v6" });
    expect(input.email).toBeUndefined();
    expect(input.subject).toContain("Job reminder (24 hours)");
    expect(input.body).toContain("Hannah published version 6");
  });

  it("never throws: a failed notice does not undo the publish", async () => {
    m.users.mockRejectedValue(new Error("db down"));
    await expect(notifyEmailDesignPublished({ key: "k", label: "L", typeKey: "t", version: 2, change: "", actor: { id: "a", name: null } })).resolves.toBeUndefined();
  });
});
