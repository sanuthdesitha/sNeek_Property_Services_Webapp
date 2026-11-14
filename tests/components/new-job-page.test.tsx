import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewJobPage, type NewJobPageProps } from "@/components/v2/admin/jobs/new-job/new-job-page";
import { draftStorageKey } from "@/lib/jobs/new-job/draft";

/** The New job page (boards "New job" and "New job on a phone", 2026-11). */
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));

const props: NewJobPageProps = {
  storageScope: "admin-1:admin-1:ADMIN",
  timezone: "Australia/Sydney",
  todayKey: "2026-11-14",
  initialPropertyId: null,
  initialDuplicateId: null,
  initialMode: null,
  rights: { canCreate: true, canRepeat: true, reason: null },
};

const options = {
  properties: [
    { id: "p1", name: "Bondi Beach House", address: "12 Campbell Parade", suburb: "Bondi Beach", clientName: "Harbour View Stays", isActive: true, isOneOff: false, lastJobDayKey: "2026-11-16" },
    { id: "p2", name: "Coogee Terrace", address: "3 Arden St", suburb: "Coogee", clientName: "Kim Tran", isActive: true, isOneOff: false, lastJobDayKey: null },
  ],
  recentPropertyIds: ["p1", "p2"],
  recurring: { enabled: true, lookaheadDays: 14 },
};

function facts(id: string, name: string, preferred: string | null) {
  return {
    property: { id, name, address: "x", suburb: "y", isActive: true, imageUrl: null, bedrooms: 2, bathrooms: 2, sofaBedCount: 1, hasBalcony: true, laundryEnabled: true, inventoryEnabled: true, defaultCheckinTime: "15:00", defaultCheckoutTime: "10:00", keyLostMode: false },
    client: { id: "c1", name: "Harbour View Stays" },
    laundry: { partnerNames: ["CleanCo"], bagLabel: "BBH", bagColor: "blue" },
    ical: null,
    preferredCleaner: preferred ? { id: "tom", name: preferred, active: true } : null,
    hours: id === "p1" ? 3 : null,
    clientPrice: id === "p1" ? { amount: 165, source: "PROPERTY_RATE", missing: false } : { amount: null, source: "MISSING", missing: true },
    cleanerPay: { rate: 60, basis: "property_rate" },
    form: { name: "Airbnb turnover", version: 7, source: "property_override" },
    access: { hasGuide: true, guideEntries: 3, guidePhotos: 3, keyLocation: null },
    carryForward: { count: 0, titles: [] },
    recentTaskTitles: ["Inside fridge"],
  };
}

function dayCheck(dayKey: string, clash: boolean) {
  return {
    days: [{
      dayKey,
      guestOut: { guestName: null, reservationCode: "HMX4Q2", time: "10:00", adults: 2, children: null, nights: 3 },
      guestIn: { guestName: null, reservationCode: "HMK8T1", time: "15:00", adults: 4, children: null, nights: 3 },
      windowHours: 5,
      sameDayJobs: clash ? [{ jobId: "j88", jobNumber: "J-1088", jobType: "AIRBNB_TURNOVER", startTime: "10:00", status: "ASSIGNED", fromCalendar: true, cleaners: ["Tom Nguyen"], accepted: true }] : [],
      laundry: { kind: "preview", rulesVersion: 4, pickupDate: "2026-11-21", dropoffDate: "2026-11-22", pickupTime: "09:00", dropoffTime: null, scenario: "MICRO_CYCLE", flagged: false, flagReason: null, note: null, nextCleanDayKey: "2026-11-23" },
      carryForwardAttaches: "not_applicable",
    }],
    suggestions: { kind: "ok", dayKey, considered: 2, items: [
      { cleanerId: "tom", name: "Tom Nguyen", assignable: true, blocker: null, reasons: ["22 cleans here", "free all day"] },
      { cleanerId: "maria", name: "Maria Santos", assignable: true, blocker: null, reasons: ["14 cleans here"] },
      { cleanerId: "aisha", name: "Aisha Rahman", assignable: false, blocker: { kind: "leave", reason: "On leave 18–22 Nov" }, reasons: [] },
    ] },
    bookingEmail: { applies: true, automationOn: true, clientOptedOut: false, providerConfigured: true, recipients: ["olivia@x.au"], subject: "Booking confirmed", bodyText: "Hi Olivia", blockedReason: null },
  };
}

type Handler = (url: string, init?: RequestInit) => Promise<Response> | Response;
let clash = false;
let postHandler: Handler;
let factsDelay: Record<string, number> = {};
const posts: Array<{ url: string; key: string | null; body: Record<string, unknown> }> = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (url.startsWith("/api/admin/jobs/new-job/options")) return json(options);
    if (url.startsWith("/api/admin/jobs/new-job/property")) {
      const id = new URL(url, "http://x").searchParams.get("propertyId")!;
      if (factsDelay[id]) await new Promise((resolve) => setTimeout(resolve, factsDelay[id]));
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return json(id === "p1" ? facts("p1", "Bondi Beach House", "Tom Nguyen") : facts("p2", "Coogee Terrace", null));
    }
    if (url.startsWith("/api/admin/jobs/new-job/day")) {
      const dates = new URL(url, "http://x").searchParams.get("dates")!;
      return json(dayCheck(dates.split(",")[0], clash));
    }
    if (url === "/api/admin/jobs" && init?.method === "POST") {
      const headers = init.headers as Record<string, string>;
      posts.push({ url, key: headers["Idempotency-Key"] ?? null, body: JSON.parse(String(init.body)) });
      return postHandler(url, init);
    }
    if (url.endsWith("/assign")) {
      posts.push({ url, key: null, body: JSON.parse(String(init?.body)) });
      return json({ ok: true });
    }
    return json({});
  }));
}

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  clash = false;
  factsDelay = {};
  posts.length = 0;
  localStorage.clear();
  postHandler = () => json({ id: "job-94", jobNumber: "J-1094", replayed: false, followUps: { carryForwardAttached: 0, preferredCleaner: { outcome: "offered", cleanerId: "tom" }, bookingEmail: { outcome: "accepted", recipients: ["olivia@x.au"] } } }, 201);
  setPhone(false);
  installFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function chooseBondiAndDate() {
  fireEvent.click(await screen.findByRole("button", { name: "Bondi Beach House" }));
  await screen.findByText(/2 bedrooms · 2 bathrooms/);
  fireEvent.change(document.getElementById("new-job-date")!, { target: { value: "2026-11-20" } });
  await screen.findAllByText(/From the calendar, Fri,? 20 Nov/);
}

describe("desktop page", () => {
  it("has one h1, nothing is posted before Create, and Create on an empty job moves focus to the first problem", async () => {
    render(<NewJobPage {...props} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    await screen.findByRole("button", { name: "Bondi Beach House" });
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));
    await waitFor(() => expect(document.activeElement?.id).toBe("new-job-property-search"));
    expect(screen.getByText("Shown in the summary and at the field · 2 to fix")).toBeInTheDocument();
    expect(screen.getByRole("status").textContent).toMatch(/2 to fix: Choose a property; Choose a date/);
    expect(posts).toHaveLength(0);
  });

  it("fills from the property, says the preferred cleaner is offered, and creates with a request key", async () => {
    render(<NewJobPage {...props} />);
    await chooseBondiAndDate();
    expect((document.getElementById("new-job-hours") as HTMLInputElement).value).toBe("3");
    expect(screen.getByText(/Tom Nguyen is the property's preferred cleaner and is offered the job automatically/)).toBeInTheDocument();
    expect(screen.getByText("On leave 18–22 Nov")).toBeInTheDocument();
    expect(await screen.findByText(/Scheduling rules, live version 4/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));
    await screen.findByText(/J-1094 created/);
    expect(posts).toHaveLength(1);
    expect(posts[0].key).toMatch(/[0-9a-f-]{20,}/);
    expect(posts[0].body).toMatchObject({ propertyId: "p1", scheduledDate: "2026-11-20T00:00:00.000Z", startTime: "10:00", dueTime: "15:00", estimatedHours: 3, isDraft: false });
    expect(posts[0].body).not.toHaveProperty("skipPreferredCleaner");
    expect(screen.getByText(/Tom Nguyen offered, not yet accepted\. Booking confirmation accepted by the email provider for 1 recipient, not delivered yet\./)).toBeInTheDocument();
    expect(localStorage.getItem(draftStorageKey(props.storageScope))).toBeNull();
  });

  it("a chosen cleaner is assigned with the existing assign call after create", async () => {
    render(<NewJobPage {...props} />);
    await chooseBondiAndDate();
    fireEvent.click(screen.getByRole("button", { name: "Choose Maria Santos" }));
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));
    await screen.findByText(/J-1094 created/);
    expect(posts.map((post) => post.url)).toEqual(["/api/admin/jobs", "/api/admin/jobs/job-94/assign"]);
    expect(posts[1].body).toEqual({ userIds: ["maria"], primaryUserId: "maria" });
  });

  it("a second job the same day asks once (tier A) before creating", async () => {
    clash = true;
    render(<NewJobPage {...props} />);
    await chooseBondiAndDate();
    expect(screen.getAllByText(/J-1088 Airbnb turnover/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Create a second job at Bondi Beach House on Fri,? 20 Nov\?/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open J-1088 instead" })).toHaveAttribute("href", "/v2/admin/jobs/j88");
    expect(posts).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create anyway" }));
    await screen.findByText(/J-1094 created/);
    expect(posts).toHaveLength(1);
  });

  it("a dropped connection keeps the draft and the retry reuses the same request key", async () => {
    let attempt = 0;
    postHandler = () => {
      attempt += 1;
      if (attempt === 1) throw new TypeError("Failed to fetch");
      return json({ id: "job-94", jobNumber: "J-1094", replayed: true, followUps: null }, 200);
    };
    render(<NewJobPage {...props} />);
    await chooseBondiAndDate();
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));
    await screen.findByText(/The connection dropped/);
    expect(screen.getByText(/Retry creates only what is missing and never a second copy/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText(/J-1094 was already created by an earlier attempt/);
    expect(posts).toHaveLength(2);
    expect(posts[1].key).toBe(posts[0].key);
  });

  it("changing the property after choosing a date asks, then clears the date and keeps notes", async () => {
    render(<NewJobPage {...props} />);
    await chooseBondiAndDate();
    fireEvent.change(screen.getByLabelText("Internal note, office only"), { target: { value: "Owner visiting Sat" } });
    fireEvent.click(screen.getByRole("button", { name: "Coogee Terrace" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/The date, cleaner, tasks and warnings are cleared/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Choose property" }));
    await waitFor(() => expect((document.getElementById("new-job-date") as HTMLInputElement).value).toBe(""));
    expect((screen.getByLabelText("Internal note, office only") as HTMLTextAreaElement).value).toBe("Owner visiting Sat");
    expect(await screen.findByText(/Not set: no property rate or price book rate/)).toBeInTheDocument();
  });

  it("a late answer for the previous property never fills the page", async () => {
    factsDelay = { p1: 150 };
    render(<NewJobPage {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Bondi Beach House" }));
    fireEvent.click(screen.getByRole("button", { name: "Coogee Terrace" }));
    await screen.findByText(/This property has no preferred cleaner/);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
    expect(screen.queryByText(/Tom Nguyen is the property's preferred cleaner/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Coogee Terrace").length).toBeGreaterThan(0);
  });

  it("keeps the unsaved job in this browser and offers it back; Start again clears it", async () => {
    const first = render(<NewJobPage {...props} />);
    await chooseBondiAndDate();
    await waitFor(() => expect(localStorage.getItem(draftStorageKey(props.storageScope))).toContain("2026-11-20"), { timeout: 2000 });
    first.unmount();
    render(<NewJobPage {...props} />);
    expect(await screen.findByText("Coming back to an unsaved job")).toBeInTheDocument();
    expect(screen.getByText(/Bondi Beach House, Airbnb turnover, Fri,? 20 Nov/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect((document.getElementById("new-job-date") as HTMLInputElement).value).toBe("2026-11-20"));
  });

  it("leave unassigned and do not send are sent as explicit choices", async () => {
    render(<NewJobPage {...props} />);
    await chooseBondiAndDate();
    fireEvent.click(screen.getByLabelText(/Leave unassigned and skip the preferred cleaner/));
    fireEvent.click(screen.getByLabelText(/Do not send for this job/));
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));
    await screen.findByText(/J-1094 created/);
    expect(posts[0].body).toMatchObject({ skipPreferredCleaner: true, sendBookingConfirmation: false });
  });

  it("view-only access cannot create and says why", async () => {
    render(<NewJobPage {...props} rights={{ canCreate: false, canRepeat: false, reason: "Your access to Jobs is view only, so you can look but not create." }} />);
    expect(await screen.findByText(/view only/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create job" })).toBeDisabled();
  });
});

describe("phone steps", () => {
  beforeEach(() => setPhone(true));

  it("shows five steps, one h1, and Next is never disabled: it marks the step and says what to fix", async () => {
    render(<NewJobPage {...props} />);
    const nav = await screen.findByRole("navigation", { name: "New job steps" });
    expect(within(nav).getAllByRole("button").map((button) => button.textContent?.replace(/[!✓\s]/g, ""))).toEqual(["Property", "Job", "When", "Who", "Review"]);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Next: job" }));
    await waitFor(() => expect(within(nav).getByRole("button", { name: /Property/ }).textContent).toContain("!"));
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /When/ }).textContent).not.toContain("!");
  });

  it("walks Property → Job → When → Who → Review and posts the same request as desktop", async () => {
    render(<NewJobPage {...props} />);
    fireEvent.change(await screen.findByLabelText("Search properties"), { target: { value: "bondi" } });
    fireEvent.click(await screen.findByRole("radio", { name: /Bondi Beach House/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next: job" }));
    expect(await screen.findByText("Step 2 of 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next: when" }));
    fireEvent.change(await screen.findByLabelText("Date"), { target: { value: "2026-11-20" } });
    await screen.findByText(/Fri,? 20 Nov calendar/);
    fireEvent.click(screen.getByRole("button", { name: "Next: who" }));
    expect(await screen.findByText("Step 4 of 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next: review" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create job" }));
    await screen.findByText(/J-1094 created/);
    expect(posts[0].body).toMatchObject({ propertyId: "p1", scheduledDate: "2026-11-20T00:00:00.000Z", estimatedHours: 3 });
    expect(posts[0].key).toBeTruthy();
  });

  it("Back keeps everything entered", async () => {
    render(<NewJobPage {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Bondi Beach House" }));
    fireEvent.click(screen.getByRole("button", { name: "Next: job" }));
    await screen.findByText("Step 2 of 5");
    fireEvent.change(screen.getByLabelText("Internal note, office only"), { target: { value: "Keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
    await screen.findByText("Step 1 of 5");
    fireEvent.click(screen.getByRole("button", { name: "Next: job" }));
    expect(((await screen.findByLabelText("Internal note, office only")) as HTMLTextAreaElement).value).toBe("Keep me");
  });
});
