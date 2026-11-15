// @vitest-environment node
/**
 * Routes behind the six designs built 2026-11-17 (Form results and stats,
 * Message templates, Property form, QA templates, Checklist coverage, Report
 * themes): live role guards, stale-write guards, read-only preview, the
 * survey link email through the design system with EMAIL only, and the old
 * URLs still redirecting into their tabs and panels.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    role: "ADMIN" as string,
    impersonating: false,
    redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
    db: {
      messageTemplate: { findMany: fn(), findUnique: fn(), findUniqueOrThrow: fn(), create: fn(), update: fn(), updateMany: fn(), delete: fn() },
      clientAutomationRule: { findMany: fn(), updateMany: fn() },
      emailCampaign: { findMany: fn() },
      appSetting: { findUnique: fn(), upsert: fn(), create: fn() },
      qaFormTemplate: { findUnique: fn(), update: fn() },
      reportTheme: { findUnique: fn(), update: fn(), create: fn(), findMany: fn() },
      property: { findUnique: fn(), findMany: fn() },
      propertyChecklistProfile: { create: fn() },
      auditLog: { create: fn(), count: fn() },
      $queryRaw: vi.fn(async () => []),
    } as Record<string, any>,
    sendExternal: vi.fn(),
    availability: vi.fn(),
    wordingRender: vi.fn(),
    preview: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: new Proxy(m.db, { get: (target, key) => (key === "$transaction" ? async (run: (tx: unknown) => unknown) => run(target) : target[key as string]) }) }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/lib/auth/session", () => ({
  requireRole: vi.fn(async (roles: string[]) => {
    if (!roles.includes(m.role)) throw new Error("FORBIDDEN");
    return { user: { id: "u1", name: "Hannah Lee", role: m.role }, impersonation: m.impersonating ? { targetId: "x" } : null };
  }),
}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney", companyName: "sNeek" }) }));
vi.mock("@/lib/notifications/external-recipient", async (original) => {
  const actual = await original<typeof import("@/lib/notifications/external-recipient")>();
  return { ...actual, sendExternalRecipientMessage: m.sendExternal, externalTransportAvailability: m.availability };
});
vi.mock("@/lib/notifications/wording/render", () => ({ loadNotificationWording: async () => ({ render: m.wordingRender }) }));
vi.mock("@/lib/reports/generator", () => ({ renderReportThemePreview: m.preview, generateJobReport: vi.fn(() => { throw new Error("must not generate"); }) }));

import { PATCH as patchMessage } from "@/app/api/admin/message-templates/[id]/route";
import { POST as createMessage } from "@/app/api/admin/message-templates/route";
import { GET as insertList } from "@/app/api/admin/messages/templates/route";
import { PUT as putPropertyForm, GET as getPropertyForm } from "@/app/api/admin/settings/property-form/route";
import { PATCH as patchQa } from "@/app/api/admin/qa/templates/[id]/route";
import { PATCH as patchTheme } from "@/app/api/admin/report-themes/[id]/route";
import { POST as previewTheme } from "@/app/api/admin/report-themes/preview/route";
import { POST as emailLink } from "@/app/api/admin/properties/[id]/amenities-link/email/route";
import FormStatsRedirect from "@/app/v2/admin/forms/stats/page";
import QaTemplatesRedirect from "@/app/v2/admin/qa-templates/page";
import TemplatesRedirect from "@/app/v2/admin/templates/page";
import ChecklistsRedirect from "@/app/v2/admin/checklists/page";

const req = (body: unknown, method = "POST", url = "http://localhost/api") => new NextRequest(url, { method, body: method === "GET" ? undefined : JSON.stringify(body) });
const at = new Date("2026-11-15T01:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  m.role = "ADMIN";
  m.impersonating = false;
  m.db.$queryRaw.mockResolvedValue([]);
});

describe("message templates", () => {
  it("accepts the category and Both, and drops the subject for SMS", async () => {
    m.db.messageTemplate.create.mockImplementation(async ({ data }: { data: unknown }) => ({ id: "t", ...(data as object) }));
    const res = await createMessage(req({ name: "Shift available", triggerType: "MANUAL", channel: "SMS", category: "CLEANER_FACING", subject: "x", body: "Hi" }));
    expect(res.status).toBe(201);
    expect(m.db.messageTemplate.create.mock.calls[0][0].data).toMatchObject({ category: "CLEANER_FACING", channel: "SMS", subject: null });
    expect((await createMessage(req({ name: "B", triggerType: "MANUAL", channel: "BOTH", body: "Hi" }))).status).toBe(201);
  });

  it("refuses a save on top of someone else's (409 with theirs) and keeps the old unguarded save", async () => {
    m.db.messageTemplate.updateMany.mockResolvedValue({ count: 0 });
    m.db.messageTemplate.findUnique.mockResolvedValue({ id: "t", name: "Theirs" });
    const res = await patchMessage(req({ name: "Mine", expectedUpdatedAt: at.toISOString() }, "PATCH"), { params: { id: "t" } });
    expect(res.status).toBe(409);
    expect((await res.json()).current.name).toBe("Theirs");
    m.db.messageTemplate.update.mockResolvedValue({ id: "t", name: "Mine" });
    expect((await patchMessage(req({ name: "Mine" }, "PATCH"), { params: { id: "t" } })).status).toBe(200);
  });

  it("lists insert templates for an audience by category", async () => {
    m.db.messageTemplate.findMany.mockResolvedValue([]);
    await insertList(req(null, "GET", "http://localhost/api/admin/messages/templates?audience=cleaner"));
    expect(m.db.messageTemplate.findMany.mock.calls[0][0].where).toEqual({ isActive: true, category: { in: ["CLEANER_FACING"] } });
    await insertList(req(null, "GET", "http://localhost/api/admin/messages/templates"));
    expect(m.db.messageTemplate.findMany.mock.calls[1][0].where).toEqual({ isActive: true });
  });

  it("is refused to roles outside ADMIN and OPS_MANAGER", async () => {
    m.role = "CLEANER";
    expect((await patchMessage(req({ name: "x" }, "PATCH"), { params: { id: "t" } })).status).toBe(403);
  });
});

describe("property form", () => {
  it("returns the revision and refuses a stale save with the current config", async () => {
    m.db.appSetting.findUnique.mockResolvedValue({ key: "propertyFormConfig", value: { version: 1, systemFields: { postcode: { required: true } }, customFields: [] }, updatedAt: at });
    const got = await (await getPropertyForm()).json();
    expect(got.revision).toBe(at.toISOString());
    const res = await putPropertyForm(req({ config: { version: 1, systemFields: {}, customFields: [] }, expectedRevision: "2026-11-01T00:00:00.000Z" }, "PUT"));
    expect(res.status).toBe(409);
    expect((await res.json()).current.systemFields.postcode.required).toBe(true);
    expect(m.db.appSetting.upsert).not.toHaveBeenCalled();
  });

  it("saves on the current revision", async () => {
    m.db.appSetting.findUnique.mockResolvedValue({ key: "propertyFormConfig", value: {}, updatedAt: at });
    m.db.appSetting.upsert.mockResolvedValue({ updatedAt: new Date("2026-11-15T02:00:00.000Z") });
    const res = await putPropertyForm(req({ config: { version: 1, systemFields: { postcode: { required: true } }, customFields: [] }, expectedRevision: at.toISOString() }, "PUT"));
    expect(res.status).toBe(200);
    expect((await res.json()).revision).toBe("2026-11-15T02:00:00.000Z");
  });
});

describe("QA templates", () => {
  it("refuses a stale save (409) and still never blocks on an overlap", async () => {
    m.db.qaFormTemplate.findUnique.mockResolvedValue({ id: "q", name: "QA", schema: { sections: [] }, updatedAt: at, version: 3 });
    const stale = await patchQa(req({ name: "Mine", expectedUpdatedAt: "2026-11-01T00:00:00.000Z" }, "PATCH"), { params: { id: "q" } });
    expect(stale.status).toBe(409);
    expect(m.db.qaFormTemplate.update).not.toHaveBeenCalled();
  });

  it("is ADMIN only for writes, as today", async () => {
    m.role = "OPS_MANAGER";
    expect((await patchQa(req({ name: "x" }, "PATCH"), { params: { id: "q" } })).status).toBe(403);
  });
});

describe("report themes", () => {
  it("limits the title to the three variables the generator fills and stores the footer as plain text", async () => {
    const bad = await patchTheme(req({ titleTemplate: "{{client.name}} report" }, "PATCH"), { params: { id: "th" } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("{{client.name}}");
    m.db.reportTheme.findUnique.mockResolvedValue({ id: "th", isDefault: false, updatedAt: at });
    m.db.reportTheme.update.mockImplementation(async ({ data }: { data: unknown }) => ({ id: "th", ...(data as object) }));
    const ok = await patchTheme(req({ footerHtml: "<b>sNeek</b> · hello@sneek.au", titleTemplate: "{{property.name}}, {{job.scheduledFor | date short}}" }, "PATCH"), { params: { id: "th" } });
    expect(ok.status).toBe(200);
    expect(m.db.reportTheme.update.mock.calls[0][0].data.footerHtml).toBe("sNeek · hello@sneek.au");
  });

  it("refuses to switch off the default and refuses a stale save", async () => {
    m.db.reportTheme.findUnique.mockResolvedValue({ id: "th", isDefault: true, updatedAt: at });
    expect((await patchTheme(req({ isActive: false }, "PATCH"), { params: { id: "th" } })).status).toBe(400);
    expect((await patchTheme(req({ name: "x", expectedUpdatedAt: "2026-11-01T00:00:00.000Z" }, "PATCH"), { params: { id: "th" } })).status).toBe(409);
    expect(m.db.reportTheme.update).not.toHaveBeenCalled();
  });

  it("previews through the generator with the unsaved theme and writes nothing", async () => {
    m.preview.mockResolvedValue("<html>report</html>");
    const res = await previewTheme(req({ jobId: "j1", theme: { name: "Draft", primaryColorHsl: "158 42% 20%", layout: { photoSize: "hero" } } }));
    expect(res.status).toBe(200);
    expect((await res.json()).html).toBe("<html>report</html>");
    expect(m.preview.mock.calls[0][1]).toMatchObject({ primaryColorHsl: "158 42% 20%", layout: { photoSize: "hero" } });
    for (const model of ["reportTheme", "appSetting", "auditLog"]) for (const method of Object.values(m.db[model])) expect(method).not.toHaveBeenCalled();
  });
});

describe("amenities survey link email", () => {
  const token = "a".repeat(48);
  beforeEach(() => {
    m.availability.mockResolvedValue({ EMAIL: { available: true, reason: null }, SMS: { available: false, reason: "off" } });
    m.wordingRender.mockReturnValue({ subject: "sNeek: what does Manly Loft have?", html: "<!-- design -->designed" });
    m.sendExternal.mockResolvedValue({ state: "provider_accepted", errorCode: null, requestId: "r" });
  });

  it("emails the link the office made, by EMAIL only, as the type's block design", async () => {
    m.db.appSetting.findUnique.mockResolvedValue({ value: { propertyId: "p1", expiresAt: "2026-11-28T00:00:00.000Z" } });
    m.db.property.findUnique.mockResolvedValue({ id: "p1", name: "Manly Loft", client: { email: "office@northside.test" } });
    const res = await emailLink(req({ token, idempotencyKey: "key-12345678" }), { params: { id: "p1" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "provider_accepted", to: "o***@northside.test" });
    expect(m.wordingRender).toHaveBeenCalledWith("email", "EMAIL", expect.objectContaining({ propertyName: "Manly Loft", surveyUrl: expect.stringContaining(`/amenities/${token}`) }));
    expect(m.sendExternal.mock.calls[0][0]).toMatchObject({ kind: "checklist.amenities_link", transport: "EMAIL", to: "office@northside.test", email: { html: "<!-- design -->designed" } });
  });

  it("refuses another property's link, an expired link, a client without email and impersonation", async () => {
    m.db.appSetting.findUnique.mockResolvedValue({ value: { propertyId: "other", expiresAt: "2026-11-28T00:00:00.000Z" } });
    expect((await emailLink(req({ token, idempotencyKey: "key-12345678" }), { params: { id: "p1" } })).status).toBe(404);
    m.db.appSetting.findUnique.mockResolvedValue({ value: { propertyId: "p1", expiresAt: "2020-01-01T00:00:00.000Z" } });
    expect((await emailLink(req({ token, idempotencyKey: "key-12345678" }), { params: { id: "p1" } })).status).toBe(409);
    m.db.appSetting.findUnique.mockResolvedValue({ value: { propertyId: "p1", expiresAt: "2099-01-01T00:00:00.000Z" } });
    m.db.property.findUnique.mockResolvedValue({ id: "p1", name: "Manly Loft", client: { email: null } });
    const noEmail = await emailLink(req({ token, idempotencyKey: "key-12345678" }), { params: { id: "p1" } });
    expect(noEmail.status).toBe(409);
    expect((await noEmail.json()).error).toContain("no billing email");
    m.impersonating = true;
    expect((await emailLink(req({ token, idempotencyKey: "key-12345678" }), { params: { id: "p1" } })).status).toBe(403);
    expect(m.sendExternal).not.toHaveBeenCalled();
  });
});

describe("old URLs", () => {
  it.each([
    [() => FormStatsRedirect({ searchParams: { templateId: "t1", weeks: "12" } }), "/v2/admin/forms?tab=stats&templateId=t1&weeks=12"],
    [() => QaTemplatesRedirect({ searchParams: {} }), "/v2/admin/forms?tab=qa"],
    [() => TemplatesRedirect({ searchParams: { tab: "messages" } }), "/v2/admin/forms?tab=messages&view=messages"],
    [() => ChecklistsRedirect({ searchParams: {} }), "/v2/admin/forms?tab=blocks&view=library"],
  ])("redirects into its tab (%#)", (open, target) => {
    expect(open).toThrow(`REDIRECT:${target}`);
  });
});
