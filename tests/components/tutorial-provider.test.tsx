import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/v2/admin/jobs", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "admin-1", role: "ADMIN", name: "Hannah Admin" } }, status: "authenticated" }) }));

import { TutorialProvider } from "@/components/v2/tutorials/tutorial-provider";
import { HelpControls } from "@/components/v2/tutorials/help-panel";
import { tourTarget } from "@/lib/tutorials/targets";

type Writes = Array<{ url: string; body: any }>;

function state(partial: Record<string, unknown> = {}) {
  return {
    recordable: true, notRecordableReason: null, role: "ADMIN", toursOn: true, roleToursOn: true,
    dontShowAgain: [], legacyWelcomeSeen: true, progress: { "welcome.admin": { tourKey: "welcome.admin", version: 1000, status: "DONE", seenSteps: [], missingSteps: [], currentStep: 0, updatedAt: null, completedAt: null } }, settings: {},
    ...partial,
  };
}

function serve(body: unknown, writes: Writes, status = 200) {
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") writes.push({ url: String(input), body: JSON.parse(String(init.body ?? "{}")) });
    return new Response(JSON.stringify(String(input) === "/api/me/tours" && !init?.method ? body : { recorded: true }), { status });
  }) as unknown as typeof fetch;
}

function JobsPage() {
  return (
    <div>
      <HelpControls pageLabel="Jobs" />
      <div {...tourTarget("admin.jobs.filters")}>Filters</div>
      <button type="button" {...tourTarget("admin.jobs.unassigned")}>Needs a cleaner</button>
      <div {...tourTarget("admin.jobs.row")}>Table</div>
      <button type="button" {...tourTarget("admin.jobs.new")}>New job</button>
    </div>
  );
}

beforeEach(() => {
  nav.pathname = "/v2/admin/jobs";
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top: 100, left: 20, width: 200, height: 40, bottom: 140, right: 220, x: 20, y: 100, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => vi.restoreAllMocks());

describe("tutorial provider", () => {
  it("renders the page and starts no tour when the progress read fails or has an unexpected shape", async () => {
    for (const [body, status] of [[{}, 200], [{ error: "boom" }, 500], [null, 200]] as const) {
      const writes: Writes = [];
      serve(body, writes, status);
      const { unmount } = render(<TutorialProvider portal="admin"><JobsPage /></TutorialProvider>);
      expect(screen.getByText("Filters")).toBeInTheDocument();
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });
      expect(screen.queryByRole("dialog", { name: /Tour step/ })).toBeNull();
      expect(writes).toEqual([]);
      unmount();
    }
  });

  it("offers existing people one card instead of the full page tour, and Take the tour runs it", async () => {
    const writes: Writes = [];
    serve(state(), writes);
    render(<TutorialProvider portal="admin"><JobsPage /></TutorialProvider>);
    const card = await screen.findByRole("dialog", { name: "Tour available" }, { timeout: 3000 });
    expect(within(card).getByText("This page has a tour")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Take the tour" }));
    expect(await screen.findByRole("dialog", { name: "Tour step 1 of 5" })).toBeInTheDocument();
  });

  it("runs the page tour for a new person, skips and records a missing control, and keyboard keys move", async () => {
    const writes: Writes = [];
    serve(state({ legacyWelcomeSeen: false }), writes);
    render(<TutorialProvider portal="admin"><JobsPage /></TutorialProvider>);
    const first = await screen.findByRole("dialog", { name: "Tour step 1 of 5" }, { timeout: 3000 });
    expect(document.activeElement?.tagName).toBe("H2");
    expect(document.querySelector('[data-tour="admin.jobs.filters"]')?.getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(await screen.findByRole("dialog", { name: "Tour step 2 of 5" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog", { name: "Tour step 2 of 5" })).getByRole("button", { name: "Next" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Tour step 3 of 5" })).getByRole("button", { name: "Next" }));
    // Step 4 (bulk select) has no control on this page: skipped after the wait, never an error.
    expect(await screen.findByRole("dialog", { name: "Tour step 5 of 5" }, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(writes.some((entry) => entry.body.missingSteps?.includes("bulk"))).toBe(true));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Tour step 5 of 5" })).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(writes.at(-1)?.body).toMatchObject({ tourKey: "admin.jobs", status: "DONE", version: 1000 }));
  }, 15000);

  it("Escape pauses: the header offers Continue, and Continue resumes the same step", async () => {
    serve(state({ legacyWelcomeSeen: false }), []);
    render(<TutorialProvider portal="admin"><JobsPage /></TutorialProvider>);
    await screen.findByRole("dialog", { name: "Tour step 1 of 5" }, { timeout: 3000 });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Tour step/ })).toBeNull());
    fireEvent.click(screen.getAllByRole("button", { name: /Continue tour 1 of 5/ })[0]);
    expect(await screen.findByRole("dialog", { name: "Tour step 1 of 5" })).toBeInTheDocument();
  });

  it("defers over an open dialog and starts when it closes; one tour at a time", async () => {
    serve(state({ legacyWelcomeSeen: false }), []);
    function WithDialog() {
      const [open, setOpen] = React.useState(true);
      return (
        <>
          <JobsPage />
          {open ? <div role="dialog" aria-label="Edit job"><button type="button" onClick={() => setOpen(false)}>Close it</button></div> : null}
        </>
      );
    }
    render(<TutorialProvider portal="admin"><WithDialog /></TutorialProvider>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1200)); });
    expect(screen.queryByRole("dialog", { name: /Tour step/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close it" }));
    expect(await screen.findByRole("dialog", { name: "Tour step 1 of 5" }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog", { name: /Tour step|Tour available/ })).toHaveLength(1);
  }, 10000);

  it("never starts while testing as someone else; Help still lists tours with done / not done", async () => {
    const writes: Writes = [];
    serve(state({ recordable: false, notRecordableReason: "Testing as someone else: nothing is recorded.", legacyWelcomeSeen: false }), writes);
    render(<TutorialProvider portal="admin"><JobsPage /></TutorialProvider>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });
    expect(screen.queryByRole("dialog", { name: /Tour step/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const help = await screen.findByRole("dialog", { name: "Help · Jobs" });
    expect(within(help).getByText("Testing as someone else: nothing is recorded.")).toBeInTheDocument();
    expect(within(help).getAllByText("Jobs").length).toBeGreaterThan(0);
    expect(within(help).getByRole("switch", { name: "Show tours" })).toBeDisabled();
    expect(writes).toEqual([]);
  });

  it("marks reduced motion and the phone layout on the overlay", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
    serve(state({ legacyWelcomeSeen: false }), []);
    render(<TutorialProvider portal="admin"><JobsPage /></TutorialProvider>);
    await screen.findByRole("dialog", { name: "Tour step 1 of 5" }, { timeout: 3000 });
    const overlay = document.querySelector("[data-tour-ui]");
    expect(overlay?.getAttribute("data-reduced-motion")).toBe("true");
    expect(overlay?.getAttribute("data-phone")).toBe("true");
    window.matchMedia = original;
  });
});

