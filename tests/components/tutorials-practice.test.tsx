import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installPracticeGuard, practiceBlockedRequests, PRACTICE_REFUSAL } from "@/components/v2/tutorials/practice-guard";

/**
 * Practice mode sends nothing: while a practice screen is mounted, no request
 * that could write leaves the browser, whichever way a component sends it.
 */
const MUTATING = ["POST", "PUT", "PATCH", "DELETE"] as const;

let network: ReturnType<typeof vi.fn>;

beforeEach(() => {
  network = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  window.fetch = network as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mutatingCalls() {
  return network.mock.calls.filter(([input, init]) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    return method !== "GET" && method !== "HEAD";
  });
}

describe("practice guard", () => {
  it.each(MUTATING)("answers %s locally and never calls the network", async (method) => {
    const uninstall = installPracticeGuard();
    const response = await fetch("/api/admin/jobs", { method, body: "{}" });
    expect(response.status).toBe(423);
    expect((await response.json()).error).toBe(PRACTICE_REFUSAL);
    expect(network).not.toHaveBeenCalled();
    expect(practiceBlockedRequests().map((entry) => entry.method)).toEqual([method]);
    uninstall();
  });

  it("stops a Request object, a server action POST, XHR writes, beacons and native form posts", async () => {
    const uninstall = installPracticeGuard();
    await fetch(new Request("http://localhost/api/invoices/1/send", { method: "POST" }));
    await fetch("/v2/admin", { method: "POST", headers: { "Next-Action": "abc" } });

    const xhrSend = vi.spyOn(XMLHttpRequest.prototype, "abort");
    const xhr = new XMLHttpRequest();
    xhr.open("PATCH", "/api/me/tours");
    xhr.send("{}");
    expect(xhrSend).toHaveBeenCalled();

    if (typeof navigator.sendBeacon === "function") expect(navigator.sendBeacon("/api/telemetry", "x")).toBe(false);

    const form = document.createElement("form");
    form.method = "post";
    form.action = "/api/laundry/1/status";
    document.body.appendChild(form);
    const submit = new Event("submit", { bubbles: true, cancelable: true }) as SubmitEvent;
    form.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);

    expect(network).not.toHaveBeenCalled();
    expect(practiceBlockedRequests().map((entry) => entry.via)).toEqual(expect.arrayContaining(["fetch", "xhr", "form"]));
    uninstall();
    form.remove();
  });

  it("answers practice records and fixtures from sample data; other reads pass through", async () => {
    const uninstall = installPracticeGuard([{ match: /^\/api\/admin\/clients/, body: [{ id: "practice-client", name: "Practice client" }] }]);
    expect(await (await fetch("/api/admin/clients")).json()).toEqual([{ id: "practice-client", name: "Practice client" }]);
    expect((await fetch("/api/admin/invoices/practice-invoice/suggestions")).status).toBe(404);
    expect(network).not.toHaveBeenCalled();
    await fetch("/api/notifications");
    expect(network).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it("never asks for location", () => {
    const original = vi.fn();
    const geolocation = { getCurrentPosition: original, watchPosition: vi.fn() };
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: geolocation });
    const uninstall = installPracticeGuard();
    const error = vi.fn();
    navigator.geolocation.getCurrentPosition(vi.fn(), error);
    uninstall();
    expect(error).toHaveBeenCalled();
    expect(original).not.toHaveBeenCalled();
  });

  it("lets only the person's own tutorial progress through", async () => {
    const uninstall = installPracticeGuard();
    await fetch("/api/me/tours", { method: "POST", body: "{}" });
    await fetch("/api/me/toursx", { method: "POST", body: "{}" });
    uninstall();
    expect(network.mock.calls.map(([input]) => String(input))).toEqual(["/api/me/tours"]);
  });

  it("restores the browser's own fetch when the practice screen closes", async () => {
    const uninstall = installPracticeGuard();
    uninstall();
    await fetch("/api/admin/jobs", { method: "POST" });
    expect(network).toHaveBeenCalledTimes(1);
  });
});

/* ── The practice job: the real stages, clicked offer to submit ── */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/v2/cleaner/jobs/practice",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "cleaner-1", role: "CLEANER", name: "Jane Doe" } }, status: "authenticated" }) }));

describe("practice job, offer to submit", () => {
  it("walks the real stages through the tour, clicks check-in and submit, and sends no mutating request", async () => {
    const state = {
      recordable: true, notRecordableReason: null, role: "CLEANER", toursOn: true, roleToursOn: true,
      dontShowAgain: [], legacyWelcomeSeen: true, progress: {}, settings: {},
    };
    network.mockImplementation(async (input: RequestInfo | URL) =>
      String(input).startsWith("/api/me/tours")
        ? new Response(JSON.stringify(String(input) === "/api/me/tours" ? state : { recorded: true }), { status: 200 })
        : new Response(JSON.stringify({}), { status: 200 }));
    // jsdom has no layout: give every element a box so registered targets count as on screen.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top: 100, left: 20, width: 200, height: 40, bottom: 140, right: 220, x: 20, y: 100, toJSON: () => ({}) } as DOMRect);
    const { TutorialProvider } = await import("@/components/v2/tutorials/tutorial-provider");
    const { PracticeBoundary } = await import("@/components/v2/tutorials/practice-boundary");
    const { PracticeJob } = await import("@/components/v2/cleaner/practice/practice-job");
    render(
      <TutorialProvider portal="cleaner">
        <PracticeBoundary tourKey="cleaner.job.practice">
          <PracticeJob />
        </PracticeBoundary>
      </TutorialProvider>,
    );
    expect(await screen.findByText("Practice · nothing is sent")).toBeInTheDocument();

    const seenTitles: string[] = [];
    for (let guard = 0; guard < 12; guard += 1) {
      const tip = await screen.findByRole("dialog", { name: /Tour step \d+ of \d+/ }, { timeout: 4000 }).catch((error) => {
        throw new Error(`No tour step after: ${seenTitles.join(" > ")}. ${String(error).slice(0, 200)}`);
      });
      const title = tip.querySelector("h2")?.textContent ?? "";
      seenTitles.push(title);
      if (title === "Check in on site") {
        const checkIn = document.querySelector<HTMLButtonElement>('[data-tour="cleaner.job.checkIn"]');
        await act(async () => { fireEvent.click(checkIn!); });
        expect(await screen.findByText(/Practice: the clock did not start/)).toBeInTheDocument();
      }
      if (title === "Submit and wait for the receipt") {
        const submit = document.querySelector<HTMLButtonElement>('[data-tour="cleaner.job.submit"]');
        await act(async () => { fireEvent.click(submit!); });
        expect(await screen.findByText(/Practice receipt P-0001/)).toBeInTheDocument();
      }
      const next = within(tip).getByRole("button", { name: /^(Next|Done)$/ });
      const done = next.textContent === "Done";
      await act(async () => { fireEvent.click(next); });
      if (done) break;
      await waitFor(() => expect(screen.queryByRole("dialog", { name: new RegExp(`Tour step ${guard + 1} of`) })).toBeNull());
    }
    expect(seenTitles).toEqual([
      "Accept the job", "On your way", "Check in on site", "No location fix?", "Room by room",
      "Photos are stamped", "Submit and wait for the receipt", "Took longer?",
    ]);
    const writes = mutatingCalls().filter(([input]) => !String(input).startsWith("/api/me/tours"));
    expect(writes).toEqual([]);
  }, 30000);
});
