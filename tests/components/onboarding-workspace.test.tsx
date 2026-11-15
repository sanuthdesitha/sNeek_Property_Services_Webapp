/**
 * Onboarding screens (2026-11-16): Start onboarding creates nothing on
 * opening and makes the draft on the first save with one Idempotency-Key for
 * every retry; the workspace saves a field when it is left, shows "changed by
 * someone else" on a stale save, keeps a failed change for Retry; on a phone
 * the checklist opens a step full screen with Previous and Next docked.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const phone = vi.hoisted(() => ({ value: false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/v2/admin/onboarding/OB-1", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/v2/ui/use-phone", () => ({ useIsPhone: () => phone.value }));
vi.mock("@/components/v2/admin/properties/property-checklist-profile", () => ({ PropertyChecklistProfile: () => <p>Checklist fixture</p> }));
vi.mock("@/components/v2/admin/onboarding/address-input", () => ({
  EAddressInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <input aria-label="Address fixture" value={value} onChange={(e) => onChange(e.target.value)} />,
}));

import { OnboardingStart } from "@/components/v2/admin/onboarding/workspace/onboarding-start";
import { OnboardingWorkspace } from "@/components/v2/admin/onboarding/workspace/onboarding-workspace";
import { computeReadiness } from "@/lib/onboarding/workspace/readiness";
import { readWorkspace } from "@/lib/onboarding/workspace/types";
import { sectionValues, type SurveyEditState } from "@/lib/onboarding/workspace/values";
import type { OnboardingWorkspaceView } from "@/lib/onboarding/workspace/view-types";

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
let calls: Call[];
let respond: (call: Call) => Response;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fixtureView(): OnboardingWorkspaceView {
  const state: SurveyEditState = {
    isNewClient: false, existingClientId: null, clientData: null,
    propertyName: "Bondi Beach House", propertyAddress: "12 Campbell Pde", propertySuburb: "Bondi Beach", propertyState: "NSW", propertyPostcode: "2026", propertyNotes: null,
    propertyType: null, floorCount: 1, sizeSqm: null, bedrooms: 2, bathrooms: 2, hasBalcony: false, estimatedCleanerCount: null, estimatedHours: null,
    icalUrl: null, icalProvider: "ICAL_OTHER", laundrySupplierId: null, meta: { selectedJobTypes: [] }, workspace: readWorkspace(null), appliances: [], specialRequests: [], laundryDetail: null,
  };
  const readiness = computeReadiness({ clientLabel: null, propertyName: "Bondi Beach House", address: "12 Campbell Pde", suburb: "Bondi Beach", hasPin: false, jobTypes: [], access: [], legacyAccessCount: 0, rates: [], bedrooms: 2, bathrooms: 2, roomCount: 0, laundryEnabled: null, laundryPartnerName: null, stockRowCount: 0, checklistReviewed: false, photoTotal: 0, photoDone: 0, hasCalendarLink: false, houseRulesFilled: false, skipped: [] });
  return {
    id: "s1", surveyNumber: "OB-1", status: "DRAFT", sourceType: "ADMIN_CREATED", revision: 4, createdAt: "2026-11-12T00:00:00Z", startedByName: "Hannah Lee",
    lastSavedAt: "2026-11-16T03:06:00Z", lastSavedByName: "Hannah Lee", lastSavedSource: "ADMIN_CREATED", timezone: "Australia/Sydney",
    values: sectionValues(state), clientName: null, clientContact: { email: null, phone: null }, laundryPartnerName: null, legacyAccess: [], legacyAlarmCodeSaved: false,
    checklistReviewed: false, skipped: [], readiness, clientLinks: [], askedOfClient: [], history: [], laundryRules: { state: "ok", version: 4, lines: ["Pickup is the day after the clean."] },
    rejectionReason: null, activation: null, canDeleteDrafts: true,
  };
}

beforeEach(() => {
  calls = [];
  replace.mockReset();
  phone.value = false;
  window.location.hash = "";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const call: Call = { url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return respond(call);
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Start onboarding", () => {
  it("creates nothing on opening, then creates the draft on the first save with one key for every retry", async () => {
    vi.useFakeTimers();
    let fail = true;
    respond = () => (fail ? json({ error: "Database busy" }, 503) : json({ id: "s1", surveyNumber: "OB-0044" }, 201));
    render(<OnboardingStart />);
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(calls).toHaveLength(0);
    expect(screen.getByText("Nothing is saved until you enter something.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Property name"), { target: { value: "Bondi Beach House" } });
    await act(async () => { vi.advanceTimersByTime(1600); });
    expect(calls).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toContain("Draft not saved yet: Database busy");
    expect((screen.getByLabelText("Property name") as HTMLInputElement).value).toBe("Bondi Beach House");
    fail = false;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
    expect(calls).toHaveLength(2);
    expect(calls[0].headers["Idempotency-Key"]).toBeTruthy();
    expect(calls[1].headers["Idempotency-Key"]).toBe(calls[0].headers["Idempotency-Key"]);
    expect(calls[1].body).toMatchObject({ propertyName: "Bondi Beach House", propertyState: "NSW" });
    expect(replace).toHaveBeenCalledWith("/v2/admin/onboarding/OB-0044#basics");
  });
});

describe("Onboarding workspace", () => {
  it("saves a field when it is left and shows another person's change on a stale save", async () => {
    respond = (call) => {
      if (call.method === "GET") return json(fixtureView());
      return json({ revision: 6, savedAt: "2026-11-16T03:07:00Z", section: "basics", values: { ...fixtureView().values.basics, propertyName: "Bondi House" }, readiness: fixtureView().readiness, skipped: [], conflict: { actorName: "Priya Shah", source: "CLIENT_SUBMITTED", at: "2026-11-16T03:07:00Z", section: "basics", changes: { "basics.propertyPostcode": { before: "2026", after: "2027" } } } });
    };
    render(<OnboardingWorkspace surveyId="s1" />);
    const name = await screen.findByLabelText("Property name *");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    fireEvent.change(name, { target: { value: "Bondi House" } });
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
    await act(async () => { fireEvent.blur(name); });
    await waitFor(() => expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1));
    expect(calls.find((call) => call.method === "PATCH")!.body).toEqual({ section: "basics", values: { propertyName: "Bondi House" }, baseRevision: 4 });
    expect(await screen.findByText(/Priya Shah changed Basics and address at 14:07\. Your edit is kept\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(screen.getByText(/propertyPostcode/)).toBeTruthy();
    expect((screen.getByLabelText("Property name *") as HTMLInputElement).value).toBe("Bondi House");
  });

  it("keeps a failed change on screen and sends it again on Retry with the same fields", async () => {
    let fail = true;
    respond = (call) => {
      if (call.method === "GET") return json(fixtureView());
      if (fail) return json({ error: "Database busy" }, 503);
      return json({ revision: 5, savedAt: "2026-11-16T03:08:00Z", section: "basics", values: fixtureView().values.basics, readiness: fixtureView().readiness, skipped: [], conflict: null });
    };
    render(<OnboardingWorkspace surveyId="s1" />);
    const postcode = await screen.findByLabelText("Postcode");
    fireEvent.change(postcode, { target: { value: "2027" } });
    await act(async () => { fireEvent.blur(postcode); });
    expect(await screen.findByText(/Not saved\. Database busy/)).toBeTruthy();
    fail = false;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry now" })); });
    await waitFor(() => expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(2));
    const patches = calls.filter((call) => call.method === "PATCH");
    expect(patches[1].body.values).toEqual(patches[0].body.values);
    expect(await screen.findByText(/✓ Saved/)).toBeTruthy();
  });

  it("shows the readiness step with exactly what is missing and keeps Activate disabled", async () => {
    window.location.hash = "#readiness";
    respond = () => json(fixtureView());
    render(<OnboardingWorkspace surveyId="s1" />);
    expect(await screen.findByText("Not ready yet")).toBeTruthy();
    expect(screen.getByText(/Activate needs: client, job types, access, rate for the main job type\./)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Activate property…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("on a phone, the checklist is the menu and a step opens with Previous and Next docked", async () => {
    phone.value = true;
    respond = () => json(fixtureView());
    render(<OnboardingWorkspace surveyId="s1" />);
    const access = await screen.findByRole("button", { name: /Access/ });
    expect(screen.getByRole("button", { name: /Continue: Client and owner/ })).toBeTruthy();
    fireEvent.click(access);
    expect(screen.getByText("4 · Access")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next: Laundry" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Back to the checklist" }));
    expect(screen.getByRole("navigation", { name: "Checklist" })).toBeTruthy();
  });
});
