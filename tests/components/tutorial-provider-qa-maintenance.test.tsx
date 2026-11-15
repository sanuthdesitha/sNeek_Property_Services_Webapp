/**
 * QA inspectors and maintenance workers are offered their page tour on the
 * first visit to a page that has one, and not again once it is done
 * (2026-11-17 page tours). A running clock (the QA on-site timer, a clocked-in
 * maintenance visit) defers the tour.
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/v2/qa", user: { id: "qa-1", role: "QA_INSPECTOR", name: "Quinn Inspector" } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: nav.user }, status: "authenticated" }) }));

import { TutorialProvider } from "@/components/v2/tutorials/tutorial-provider";
import { tourTarget } from "@/lib/tutorials/targets";

type Writes = Array<{ url: string; body: Record<string, unknown> }>;

function done(tourKey: string, version: number) {
  return { tourKey, version, status: "DONE", seenSteps: [], missingSteps: [], currentStep: 0, updatedAt: null, completedAt: null };
}

function state(role: string, progress: Record<string, unknown>) {
  return { recordable: true, notRecordableReason: null, role, toursOn: true, roleToursOn: true, dontShowAgain: [], legacyWelcomeSeen: false, progress, settings: {} };
}

function serve(body: unknown, writes: Writes) {
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") writes.push({ url: String(input), body: JSON.parse(String(init.body ?? "{}")) });
    return new Response(JSON.stringify(String(input) === "/api/me/tours" && !init?.method ? body : { recorded: true }), { status: 200 });
  }) as unknown as typeof fetch;
}

function QaToday() {
  return (
    <div>
      <section {...tourTarget("qa.today.figures")}>Figures</section>
      <ol {...tourTarget("qa.today.visitOrder")}><li>Stop 1</li></ol>
      <a href="/v2/qa/jobs/j1" {...tourTarget("qa.today.start")}>Start inspection</a>
      <div {...tourTarget("qa.today.queue")}>All inspections</div>
      <button type="button" {...tourTarget("qa.header.help")}>Help</button>
    </div>
  );
}

function MaintenanceVisit({ clockedIn }: { clockedIn: boolean }) {
  return (
    <div data-tour-busy={clockedIn ? "clock" : undefined}>
      <div {...tourTarget("maintenance.visit.stages")}>Stages</div>
      <div {...tourTarget("maintenance.visit.issue")}>Reported issue</div>
      <div {...tourTarget("maintenance.visit.access")}>Access</div>
      <div {...tourTarget("maintenance.visit.travel")}>Start driving</div>
      <div {...tourTarget("maintenance.visit.clockIn")}>Clock in</div>
      <div {...tourTarget("maintenance.visit.photos")}>Finish photos</div>
      <button type="button" {...tourTarget("maintenance.visit.complete")}>Complete job</button>
    </div>
  );
}

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top: 100, left: 20, width: 200, height: 40, bottom: 140, right: 220, x: 20, y: 100, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => vi.restoreAllMocks());

describe("QA inspector page tours", () => {
  beforeEach(() => {
    nav.pathname = "/v2/qa";
    nav.user = { id: "qa-1", role: "QA_INSPECTOR", name: "Quinn Inspector" };
  });

  it("offers the Today tour on the first visit and records it as done", async () => {
    const writes: Writes = [];
    serve(state("QA_INSPECTOR", { "welcome.qa": done("welcome.qa", 1000) }), writes);
    render(<TutorialProvider portal="qa"><QaToday /></TutorialProvider>);
    const first = await screen.findByRole("dialog", { name: "Tour step 1 of 5" }, { timeout: 3000 });
    expect(within(first).getByText("Your day in numbers")).toBeInTheDocument();
    for (let step = 1; step < 5; step++) {
      fireEvent.click(within(screen.getByRole("dialog", { name: `Tour step ${step} of 5` })).getByRole("button", { name: "Next" }));
      await screen.findByRole("dialog", { name: `Tour step ${step + 1} of 5` });
    }
    fireEvent.click(within(screen.getByRole("dialog", { name: "Tour step 5 of 5" })).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(writes.at(-1)?.body).toMatchObject({ tourKey: "qa.today", status: "DONE", version: 1000 }));
  }, 15000);

  it("does not offer it again once done", async () => {
    const writes: Writes = [];
    serve(state("QA_INSPECTOR", { "welcome.qa": done("welcome.qa", 1000), "qa.today": done("qa.today", 1000) }), writes);
    render(<TutorialProvider portal="qa"><QaToday /></TutorialProvider>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1500)); });
    expect(screen.queryByRole("dialog", { name: /Tour step|Tour available/ })).toBeNull();
    expect(writes).toEqual([]);
  });
});

describe("maintenance page tours", () => {
  beforeEach(() => {
    nav.pathname = "/v2/maintenance/visits/item-1";
    nav.user = { id: "maint-1", role: "MAINTENANCE", name: "Max Maintenance" };
  });

  it("offers the ticket visit tour on the first visit, and not again once done", async () => {
    const writes: Writes = [];
    serve(state("MAINTENANCE", { "welcome.maintenance": done("welcome.maintenance", 1000) }), writes);
    const { unmount } = render(<TutorialProvider portal="maintenance"><MaintenanceVisit clockedIn={false} /></TutorialProvider>);
    const first = await screen.findByRole("dialog", { name: /Tour step 1 of 8/ }, { timeout: 3000 });
    expect(within(first).getByText("Visit stages")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Tour step/ })).toBeNull());
    unmount();

    serve(state("MAINTENANCE", { "welcome.maintenance": done("welcome.maintenance", 1000), "maintenance.visit": done("maintenance.visit", 1000) }), writes);
    render(<TutorialProvider portal="maintenance"><MaintenanceVisit clockedIn={false} /></TutorialProvider>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1500)); });
    expect(screen.queryByRole("dialog", { name: /Tour step|Tour available/ })).toBeNull();
  }, 15000);

  it("never starts over a clocked-in visit", async () => {
    serve(state("MAINTENANCE", { "welcome.maintenance": done("welcome.maintenance", 1000) }), []);
    render(<TutorialProvider portal="maintenance"><MaintenanceVisit clockedIn /></TutorialProvider>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1500)); });
    expect(screen.queryByRole("dialog", { name: /Tour step/ })).toBeNull();
  });

  it("offers the Tickets tour on the tickets list", async () => {
    nav.pathname = "/v2/maintenance/tickets";
    serve(state("MAINTENANCE", { "welcome.maintenance": done("welcome.maintenance", 1000) }), []);
    render(
      <TutorialProvider portal="maintenance">
        <div {...tourTarget("maintenance.tickets.view")}>By day</div>
        <div {...tourTarget("maintenance.tickets.filters")}>Search</div>
        <div {...tourTarget("maintenance.tickets.days")}>Today (2)</div>
        <div {...tourTarget("maintenance.tickets.card")}>Leaking tap</div>
      </TutorialProvider>,
    );
    const first = await screen.findByRole("dialog", { name: "Tour step 1 of 4" }, { timeout: 3000 });
    expect(within(first).getByText("By day or by stage")).toBeInTheDocument();
  });
});
