/**
 * New onboarding survey: no blank draft on opening (owner decision
 * 2026-11-14, "do what's best"). The draft is created by the first save, the
 * first autosave after something is entered, with an idempotency key that
 * every retry reuses; the URL then becomes ?edit=<id> without re-reading the
 * survey over what was typed. A failed first save keeps the answers and offers
 * Retry.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push, refresh: vi.fn() }),
  usePathname: () => "/v2/admin/onboarding/new",
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/v2/admin/properties/property-checklist-profile", () => ({ PropertyChecklistProfile: () => <p>Checklist fixture</p> }));
vi.mock("@/components/v2/admin/onboarding/address-input", () => ({
  EAddressInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <input aria-label="Address fixture" value={value} onChange={(e) => onChange(e.target.value)} />,
}));

import { OnboardingWizard } from "@/components/v2/admin/onboarding/wizard";

type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | undefined };
let calls: Call[];
let onCreate: () => Response;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  calls = [];
  replace.mockReset();
  push.mockReset();
  onCreate = () => json({ id: "survey-1" }, 201);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method, headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (url === "/api/admin/clients") return json([]);
    if (url === "/api/admin/onboarding/surveys" && method === "POST") return onCreate();
    if (url.startsWith("/api/admin/onboarding/surveys/") && method === "PATCH") return json({ id: "survey-1" });
    return json({ error: `unexpected ${method} ${url}` }, 500);
  }));
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
const creates = () => calls.filter((call) => call.url === "/api/admin/onboarding/surveys" && call.method === "POST");
const surveyReads = () => calls.filter((call) => call.url.startsWith("/api/admin/onboarding/surveys/") && call.method === "GET");

async function enterClientName(name: string) {
  fireEvent.click(screen.getByRole("checkbox", { name: /Create a new client/ }));
  fireEvent.change(screen.getByPlaceholderText("Full name or company"), { target: { value: name } });
}

describe("new onboarding survey: first save creates the draft", () => {
  it("opening the page creates nothing, and an untouched form never autosaves", async () => {
    render(<OnboardingWizard />);
    await advance(10_000);
    expect(creates()).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("Nothing is saved until you enter something");
    // Save Draft with nothing entered still creates nothing.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Save Draft/ })); });
    expect(creates()).toHaveLength(0);
  });

  it("the first autosave after an entry creates one draft with an idempotency key, then the URL resumes it without re-reading", async () => {
    const view = render(<OnboardingWizard />);
    await enterClientName("Harbour View Stays");
    expect(creates()).toHaveLength(0);
    await advance(1500);
    expect(creates()).toHaveLength(1);
    const [create] = creates();
    expect(create.body).toMatchObject({ isNewClient: true, clientData: { name: "Harbour View Stays" } });
    expect(create.headers["Idempotency-Key"]).toMatch(/^onb-/);
    expect(replace).toHaveBeenCalledWith("/v2/admin/onboarding/new?edit=survey-1");
    // The server page re-renders with ?edit=: the typed answers stay, no reload.
    view.rerender(<OnboardingWizard editId="survey-1" />);
    await advance(10);
    expect(surveyReads()).toHaveLength(0);
    expect(screen.getByPlaceholderText("Full name or company")).toHaveValue("Harbour View Stays");
    // Later edits are not a second create.
    fireEvent.change(screen.getByPlaceholderText("Full name or company"), { target: { value: "Harbour View" } });
    await advance(5000);
    expect(creates()).toHaveLength(1);
  });

  it("a failed first save keeps the answers and Retry reuses the same key", async () => {
    onCreate = () => json({ error: "database unavailable" }, 500);
    render(<OnboardingWizard />);
    await enterClientName("Coogee Retreat");
    await advance(1500);
    expect(screen.getByRole("alert")).toHaveTextContent("Draft not saved yet: database unavailable");
    expect(screen.getByPlaceholderText("Full name or company")).toHaveValue("Coogee Retreat");
    expect(replace).not.toHaveBeenCalled();
    onCreate = () => json({ id: "survey-9" }, 200);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Retry/ })); });
    await advance(10);
    expect(creates()).toHaveLength(2);
    expect(creates()[1].headers["Idempotency-Key"]).toBe(creates()[0].headers["Idempotency-Key"]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/v2/admin/onboarding/new?edit=survey-9");
  });

  it("Next with something entered creates the draft once, shared with a pending autosave", async () => {
    render(<OnboardingWizard />);
    await enterClientName("Bondi Loft");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Next/ })); });
    await advance(5000);
    expect(creates()).toHaveLength(1);
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
  });
});
