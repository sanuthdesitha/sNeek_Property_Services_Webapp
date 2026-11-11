import * as React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { qualityTabRedirect } from "@/lib/quality/redirects";
import { parseIssueFiltersLenient } from "@/lib/quality/filters";
import { resolveQualityPeriod } from "@/lib/quality/period";

const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  shell: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: nav.redirect }));
vi.mock("@/components/v2/portal/portal-shell", () => ({
  PortalShell: (props: { nav: Array<{ href: string; label: string; badge?: number }>; children: React.ReactNode }) => {
    nav.shell(props.nav);
    return <div>{props.children}</div>;
  },
}));

describe("old Quality routes redirect to hub tabs, keeping their meaning", () => {
  it("sends each old page to its tab with every param", async () => {
    const { default: issues } = await import("@/app/v2/admin/quality/issues/page");
    const { default: accountability } = await import("@/app/v2/admin/quality/accountability/page");
    const { default: performance } = await import("@/app/v2/admin/quality/qa-performance/page");
    expect(() => issues({ searchParams: { cleanerId: "c1", severity: "MAJOR", tab: "old" } })).toThrow(
      "REDIRECT /v2/admin/quality?tab=issues&cleanerId=c1&severity=MAJOR",
    );
    expect(() => accountability({ searchParams: { period: "7d" } })).toThrow("REDIRECT /v2/admin/quality?tab=cleaners&period=7d");
    expect(() => performance({})).toThrow("REDIRECT /v2/admin/quality?tab=inspectors");
  });

  it("turns the register's from/to range into the same custom period", () => {
    const url = qualityTabRedirect("issues", { from: "2026-11-01", to: "2026-11-07", propertyId: "p1" });
    expect(url).toBe("/v2/admin/quality?tab=issues&from=2026-11-01&to=2026-11-07&propertyId=p1&period=custom");
    const params = new URL(url, "http://x").searchParams;
    expect(resolveQualityPeriod({ period: params.get("period"), from: params.get("from"), to: params.get("to") })).toMatchObject({
      fromKey: "2026-11-01",
      toKey: "2026-11-07",
      days: 7,
    });
    expect(parseIssueFiltersLenient(params)).toMatchObject({ propertyId: "p1" });
    // An explicit period wins; multi-valued params repeat.
    expect(qualityTabRedirect("issues", { period: "90d", from: "2026-11-01", a: ["1", "2"] })).toBe(
      "/v2/admin/quality?tab=issues&period=90d&from=2026-11-01&a=1&a=2",
    );
  });
});

describe("admin navigation", () => {
  it("has one Quality entry badged with a real count, keeps the reports route (now labelled Insights), drops the three old entries", async () => {
    const counts = { qualityHub: 5, quality: 2, qaIssues: 3 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ counts })));
    const { default: Layout } = await import("@/app/v2/admin/layout");
    render(<Layout>child</Layout>);
    await vi.waitFor(() => {
      const items = nav.shell.mock.calls.at(-1)?.[0] as Array<{ href: string; badge?: number }>;
      expect(items.find((item) => item.href === "/v2/admin/quality")?.badge).toBe(5);
    });
    const items = nav.shell.mock.calls.at(-1)?.[0] as Array<{ href: string; label: string }>;
    const labels = items.map((item) => item.label);
    expect(labels).toContain("Quality");
    // Reports was renamed Insights (same /v2/admin/reports route) in the Insights step.
    expect(labels).toContain("Insights");
    expect(items.find((item) => item.href === "/v2/admin/reports")?.label).toBe("Insights");
    for (const gone of ["QA Issues", "Accountability", "QA Performance"]) expect(labels).not.toContain(gone);
    expect(items.some((item) => item.href.startsWith("/v2/admin/quality/"))).toBe(false);
    vi.unstubAllGlobals();
  });
});
