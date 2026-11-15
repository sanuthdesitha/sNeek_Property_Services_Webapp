/**
 * Record pages whose first tab is the bare record URL (job page "Timeline",
 * client page "Overview") must stay selectable after another tab was chosen.
 * Owner report 2026-11-15: on the job page, after Photos, Timeline could not
 * be chosen again because view memory put `?view=photos` back on its link.
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

const nav = vi.hoisted(() => ({ pathname: "/", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { ViewMemoryProvider } from "@/components/shared/view-memory-provider";

type TabLink = { label: string; href: string };

const RECORD_PAGES: Array<{ name: string; base: string; tabs: TabLink[] }> = [
  {
    name: "job page",
    base: "/v2/admin/jobs/job-1",
    tabs: [
      { label: "Timeline", href: "/v2/admin/jobs/job-1" },
      { label: "Form answers", href: "/v2/admin/jobs/job-1?view=answers" },
      { label: "Photos", href: "/v2/admin/jobs/job-1?view=photos" },
      { label: "Clock and GPS", href: "/v2/admin/jobs/job-1?view=clock" },
      { label: "Messages", href: "/v2/admin/jobs/job-1?view=messages" },
      { label: "History", href: "/v2/admin/jobs/job-1?view=history" },
    ],
  },
  {
    name: "client page",
    base: "/v2/admin/clients/c-1",
    tabs: [
      { label: "Overview", href: "/v2/admin/clients/c-1" },
      { label: "Properties", href: "/v2/admin/clients/c-1?tab=properties" },
      { label: "History", href: "/v2/admin/clients/c-1?tab=history" },
    ],
  },
];

function routerMock() {
  return { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() };
}

function Tabs({ tabs }: { tabs: TabLink[] }) {
  return (
    <nav aria-label="Views">
      {tabs.map((tab) => (
        <a key={tab.label} href={tab.href}>{tab.label}</a>
      ))}
    </nav>
  );
}

/** Where a click on the link goes: the provider's router push, or the link itself. */
function clickDestination(router: ReturnType<typeof routerMock>, label: string, href: string): string {
  router.push.mockClear();
  const link = screen.getByRole("link", { name: label });
  // Stop jsdom's own navigation; the provider sees the click in the capture phase first.
  link.addEventListener("click", (event) => event.preventDefault(), { once: true });
  fireEvent.click(link);
  return router.push.mock.calls[0]?.[0] ?? href;
}

/** Land on a URL as a navigation would, and let the provider record it. */
function land(href: string, rerender: () => void) {
  window.dispatchEvent(new Event("pagehide"));
  const url = new URL(href, window.location.origin);
  history.replaceState({}, "", url.pathname + url.search);
  nav.pathname = url.pathname;
  nav.search = url.search;
  rerender();
}

let scope = 0;
beforeEach(() => {
  document.body.dataset.viewScope = `tabs-${++scope}`;
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe.each(RECORD_PAGES)("$name tabs", ({ base, tabs }) => {
  it("every tab can be chosen back and forth, including the bare first tab", () => {
    history.replaceState({}, "", base);
    nav.pathname = base;
    nav.search = "";
    const router = routerMock();
    const tree = () => (
      <AppRouterContext.Provider value={router as never}>
        <ViewMemoryProvider><Tabs tabs={tabs} /></ViewMemoryProvider>
      </AppRouterContext.Provider>
    );
    const view = render(tree());
    const rerender = () => view.rerender(tree());

    const first = tabs[0];
    for (const other of tabs.slice(1)) {
      const toOther = clickDestination(router, other.label, other.href);
      expect(toOther).toBe(other.href);
      land(toOther, rerender);
      expect(router.replace).not.toHaveBeenCalled();

      const back = clickDestination(router, first.label, first.href);
      expect(back).toBe(first.href);
      land(back, rerender);
      // The arrival check must not send the page back to the tab that was left.
      expect(router.replace).not.toHaveBeenCalled();
      expect(window.location.search).toBe("");
    }
  });
});

it("a bare link to another page still returns to its last view", () => {
  history.replaceState({}, "", "/v2/admin/jobs/job-9?view=photos");
  nav.pathname = "/v2/admin/jobs/job-9";
  nav.search = "?view=photos";
  const router = routerMock();
  const tree = () => (
    <AppRouterContext.Provider value={router as never}>
      <ViewMemoryProvider><a href="/v2/admin/jobs">Jobs</a><a href="/v2/admin/jobs/job-9">Back to job</a></ViewMemoryProvider>
    </AppRouterContext.Provider>
  );
  const view = render(tree());
  land("/v2/admin/jobs", () => view.rerender(tree()));
  expect(clickDestination(router, "Back to job", "/v2/admin/jobs/job-9")).toBe("/v2/admin/jobs/job-9?view=photos");
});
