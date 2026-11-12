import { describe, expect, it, vi } from "vitest";
import { allOpsLevels, canUseOpsPath, opsNavigationHref, opsRequestFeature } from "@/lib/rbac/ops-catalog";
import { formsTabRedirect, resolveFormsTab } from "@/lib/admin/forms-redirects";

const nav = vi.hoisted(() => ({ redirect: vi.fn((url: string) => { throw new Error(`REDIRECT ${url}`); }) }));
vi.mock("next/navigation", () => ({ redirect: nav.redirect }));

describe("Forms library redirects", () => {
  it("sends the old pages to their tabs and keeps their parameters", async () => {
    const { default: qa } = await import("@/app/v2/admin/qa-templates/page");
    const { default: templates } = await import("@/app/v2/admin/templates/page");
    const { default: checklists } = await import("@/app/v2/admin/checklists/page");
    const { default: stats } = await import("@/app/v2/admin/forms/stats/page");
    expect(() => qa({ searchParams: { property: "p1" } })).toThrow("REDIRECT /v2/admin/forms?tab=qa&property=p1");
    expect(() => templates({ searchParams: { tab: "messages" } })).toThrow("REDIRECT /v2/admin/forms?tab=messages&view=messages");
    expect(() => templates({})).toThrow("REDIRECT /v2/admin/forms?tab=messages&view=notifications");
    expect(() => checklists({})).toThrow("REDIRECT /v2/admin/forms?tab=blocks&view=library");
    expect(() => stats({ searchParams: { templateId: "t1", weeks: "12" } })).toThrow("REDIRECT /v2/admin/forms?tab=stats&templateId=t1&weeks=12");
  });

  it("repeats multi-valued parameters", () => {
    expect(formsTabRedirect("stats", { a: ["1", "2"], skip: undefined })).toBe("/v2/admin/forms?tab=stats&a=1&a=2");
  });

  it("keeps the old forms-page tab values meaningful", () => {
    expect(resolveFormsTab(undefined)).toEqual({ tab: "forms", legacyChecklists: false });
    expect(resolveFormsTab("templates")).toEqual({ tab: "forms", legacyChecklists: false });
    expect(resolveFormsTab("checklists")).toEqual({ tab: "blocks", legacyChecklists: true });
    expect(resolveFormsTab("stats").tab).toBe("stats");
    expect(resolveFormsTab("nonsense").tab).toBe("forms");
  });
});

describe("operations-manager ownership of the merged Forms page", () => {
  it("keeps QA templates under quality and message templates under communications, on the page only", () => {
    expect(opsRequestFeature("/v2/admin/forms")).toBe("forms");
    expect(opsRequestFeature("/v2/admin/forms?tab=stats")).toBe("forms");
    expect(opsRequestFeature("/v2/admin/forms?tab=qa")).toBe("quality");
    expect(opsRequestFeature("/v2/admin/forms?tab=messages")).toBe("communications");
    expect(opsRequestFeature("/api/admin/form-templates/library?tab=qa")).toBe("forms");
    expect(opsRequestFeature("/api/admin/form-templates/bulk")).toBe("forms");
    expect(opsRequestFeature("/api/admin/form-templates/groups")).toBe("forms");
  });

  it("gives a quality-only manager the QA tab entry and nothing else", () => {
    const qualityOnly = { ...allOpsLevels("off"), quality: "manage" as const };
    expect(opsNavigationHref(qualityOnly, "/v2/admin/forms")).toBe("/v2/admin/forms?tab=qa");
    expect(canUseOpsPath(qualityOnly, "/v2/admin/forms")).toBe(false);
    expect(canUseOpsPath(qualityOnly, "/v2/admin/forms?tab=messages")).toBe(false);
    const commsOnly = { ...allOpsLevels("off"), communications: "read" as const };
    expect(opsNavigationHref(commsOnly, "/v2/admin/forms")).toBe("/v2/admin/forms?tab=messages");
    expect(opsNavigationHref(allOpsLevels("off"), "/v2/admin/forms")).toBeNull();
    const formsOnly = { ...allOpsLevels("off"), forms: "read" as const };
    expect(opsNavigationHref(formsOnly, "/v2/admin/forms")).toBe("/v2/admin/forms");
    expect(canUseOpsPath(formsOnly, "/api/admin/form-templates/bulk", "POST")).toBe(false);
  });
});
