// @vitest-environment node
/**
 * Website "Save and publish" (board "Website and blog", 2026-11-16): ADMIN
 * only, images need alt text, and a draft started before someone else
 * published is refused (409) without saving, so the person's draft is kept.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DEFAULT_WEBSITE_CONTENT, sanitizeWebsiteContent, type WebsiteContent } from "@/lib/public-site/content";

const m = vi.hoisted(() => ({ session: vi.fn(), current: { value: null as any }, writes: [] as any[], audit: vi.fn(), history: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/portal-version-store", () => ({ invalidateDefaultPortalVersion: vi.fn() }));
vi.mock("@/lib/email-templates", () => ({ EMAIL_TEMPLATE_KEYS: [], getDefaultEmailTemplates: () => ({}) }));
vi.mock("@/lib/notification-templates", () => ({ NOTIFICATION_TEMPLATE_KEYS: [] }));
vi.mock("@/lib/db", () => ({ db: { auditLog: { create: m.audit, findMany: m.history } } }));
vi.mock("@/lib/settings", () => ({
  getAppSettings: async () => m.current.value,
  schedulingRuleFieldsChanged: () => [],
  // Same contract as lib/settings saveAppSettings: the guard runs on the current row before any write.
  saveAppSettings: async (input: any, options: { guard?: (current: any) => void } = {}) => {
    options.guard?.(m.current.value);
    m.current.value = { ...m.current.value, ...input };
    m.writes.push(input);
    return m.current.value;
  },
}));

import { PATCH } from "@/app/api/admin/settings/route";
import { websiteContentRevision } from "@/lib/public-site/website-publish";

const clone = (value: WebsiteContent): WebsiteContent => sanitizeWebsiteContent(JSON.parse(JSON.stringify(value)));
const patch = (body: unknown) => PATCH(new NextRequest("http://localhost/api/admin/settings", { method: "PATCH", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  m.writes = [];
  m.current.value = { companyName: "sNeek", timezone: "Australia/Sydney", emailTemplates: {}, websiteContent: clone(DEFAULT_WEBSITE_CONTENT) };
  m.session.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
  m.history.mockResolvedValue([]);
  m.audit.mockResolvedValue({});
});

describe("website publish", () => {
  it("publishes a draft started from the live revision and returns the new revision", async () => {
    const base = websiteContentRevision(m.current.value.websiteContent);
    const draft = clone(DEFAULT_WEBSITE_CONTENT);
    draft.home.title = "Airbnb turnovers, done before check-in";
    const res = await patch({ websiteContent: draft, websiteRevision: base });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.websiteContent.home.title).toBe("Airbnb turnovers, done before check-in");
    expect(body.websiteRevision).toBe(websiteContentRevision(body.websiteContent));
    expect(m.writes).toHaveLength(1);
    expect(m.writes[0]).not.toHaveProperty("websiteRevision");
    expect(m.audit).toHaveBeenCalledOnce();
  });

  it("refuses a stale draft with who published, saves nothing and returns the live version", async () => {
    const staleBase = websiteContentRevision(m.current.value.websiteContent);
    // Ravi published in the meantime.
    const ravis = clone(DEFAULT_WEBSITE_CONTENT);
    ravis.home.eyebrow = "Ravi's eyebrow";
    const before = m.current.value;
    m.current.value = { ...before, websiteContent: clone(ravis) };
    m.history.mockResolvedValue([{ createdAt: new Date("2026-11-14T23:12:00Z"), before, after: m.current.value, user: { name: "Ravi Mehta", email: "ravi@example.invalid" } }]);
    const mine = clone(DEFAULT_WEBSITE_CONTENT);
    mine.home.title = "My headline";
    const res = await patch({ websiteContent: mine, websiteRevision: staleBase });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("website_changed");
    expect(body.publishedByName).toBe("Ravi Mehta");
    expect(body.error).toMatch(/Nothing was published; your changes are kept/);
    expect(body.websiteContent.home.eyebrow).toBe("Ravi's eyebrow");
    expect(body.websiteRevision).toBe(websiteContentRevision(ravis));
    expect(m.writes).toHaveLength(0);
    expect(m.current.value.websiteContent.home.title).not.toBe("My headline");
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("refuses an image without alt text and saves nothing", async () => {
    const draft = clone(DEFAULT_WEBSITE_CONTENT);
    draft.gallery.items = [{ id: "new-photo", imageUrl: "https://example.invalid/bondi.jpg", imageAlt: "", caption: "", serviceType: "" }];
    const res = await patch({ websiteContent: draft, websiteRevision: websiteContentRevision(m.current.value.websiteContent) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("alt_text_missing");
    expect(body.issues[0].path).toBe("gallery.items[0].imageUrl");
    expect(body.error).toMatch(/Nothing was published/);
    expect(m.writes).toHaveLength(0);
  });

  it("a whole-settings save that sends the stored website back unchanged is not checked as a publish", async () => {
    const stored = clone(DEFAULT_WEBSITE_CONTENT);
    stored.gallery.items = [{ id: "old-photo", imageUrl: "https://example.invalid/old.jpg", imageAlt: "", caption: "", serviceType: "" }];
    m.current.value.websiteContent = clone(stored);
    const res = await patch({ companyName: "sNeek Pro", websiteContent: m.current.value.websiteContent });
    expect(res.status).toBe(200);
    expect(m.writes).toHaveLength(1);
  });

  it("only administrators can publish: an operations manager is refused before anything is read or saved", async () => {
    m.session.mockRejectedValue(new Error("FORBIDDEN"));
    const res = await patch({ websiteContent: clone(DEFAULT_WEBSITE_CONTENT) });
    expect(res.status).toBe(403);
    expect(m.session).toHaveBeenCalledWith(["ADMIN"]);
    expect(m.writes).toHaveLength(0);
  });
});
