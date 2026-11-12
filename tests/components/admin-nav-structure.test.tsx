import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

const nav = vi.hoisted(() => ({ shell: vi.fn() }));
vi.mock("@/components/v2/portal/portal-shell", () => ({
  PortalShell: ({ nav: items, children }: { nav: unknown; children: React.ReactNode }) => {
    nav.shell(items);
    return <div>{children}</div>;
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Item = { href: string; label: string; group: string };

describe("admin rail", () => {
  it("follows the approved grouping, has Messages and Suppliers, and no duplicate or merged-away entries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ counts: {} })));
    const { default: Layout } = await import("@/app/v2/admin/layout");
    render(<Layout>child</Layout>);
    const items = nav.shell.mock.calls.at(-1)?.[0] as Item[];

    const groups = [...new Set(items.map((item) => item.group))];
    expect(groups).toEqual(["Today", "Operations", "People and quality", "Money", "Setup", "System"]);

    const byGroup = (group: string) => items.filter((item) => item.group === group).map((item) => item.label);
    expect(byGroup("Today")).toEqual(["Command", "Jobs", "Calendar", "Live ops", "Approvals", "Messages"]);
    expect(byGroup("Money")).toEqual(["Invoices and pay", "Quotes and pricing", "Growth"]);
    expect(byGroup("Setup")).toEqual(["Forms", "Notifications", "Settings", "Activity log"]);
    expect(byGroup("Operations")).toEqual(expect.arrayContaining(["Cases", "Laundry", "Lost and found", "Stock", "Suppliers", "Properties"]));
    expect(byGroup("People and quality")).toEqual(expect.arrayContaining(["People", "Quality", "Insights"]));

    // One entry per destination and per label.
    expect(new Set(items.map((item) => item.href)).size).toBe(items.length);
    expect(new Set(items.map((item) => item.label)).size).toBe(items.length);

    // Pages that became tabs of another page are not listed again.
    const hrefs = items.map((item) => item.href);
    for (const merged of ["/v2/admin/clients", "/v2/admin/cleaners", "/v2/admin/workforce", "/v2/admin/workforce/coaching", "/v2/admin/pricing"]) {
      expect(hrefs).not.toContain(merged);
    }
  });
});
