import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WordingWorkspace } from "@/components/v2/admin/notifications/wording-workspace";
import { insertVariable, partsForTab, tabStates } from "@/components/v2/admin/notifications/wording-model";
import { rowSwitch, transportTags } from "@/components/v2/admin/notifications/type-row-switch";
import { NOTIFICATION_CATALOG } from "@/lib/notifications/catalog";
import type { TypeWordingResponse } from "@/lib/notifications/wording/view-types";
import { manualReminderView } from "./notification-wording-fixtures";

const fetchMock = vi.fn();
let view: TypeWordingResponse;
const reminder = NOTIFICATION_CATALOG.find((entry) => entry.key === "job.reminder.manual")!;

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  fetchMock.mockReset();
  view = manualReminderView();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.startsWith("/api/admin/notifications/wording/regenerate")) return respond({ ok: true, proposal: { title: "Job not finished", body: "{{propertyName}} ({{when}}) still needs its checklist.{{noteSentence}}" }, droppedVariables: [] });
    if (url.startsWith("/api/admin/notifications/wording/") && init?.method === "PUT") return respond({ error: "This wording changed since you opened it." }, 409);
    if (url.startsWith("/api/admin/notifications/wording/")) return respond(view);
    return respond({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderWorkspace() {
  return render(<WordingWorkspace typeKey={reminder.key} catalogTransports={reminder.transports} details={<h2>Details</h2>} timeZone="Australia/Sydney" companyName="sNeek" testBlockedReason={null} testable onSaved={() => undefined} />);
}

describe("wording editor", () => {
  it("keeps a draft while switching transport tabs and offers Push as the shared inbox wording", async () => {
    renderWorkspace();
    const title = await screen.findByLabelText("Inbox title");
    fireEvent.change(title, { target: { value: "Please finish your job" } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Email" }));
    expect(await screen.findByLabelText("Email subject")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Push" }));
    expect(screen.getByText(/Push uses the inbox title and body/)).toBeInTheDocument();
    expect(screen.getByLabelText("Inbox title")).toHaveValue("Please finish your job");
    expect(screen.getByRole("tab", { name: /SMS/ })).toBeDisabled();
  });

  it("inserts a variable chip at the caret", async () => {
    renderWorkspace();
    const body = (await screen.findByLabelText("Inbox body")) as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "Hello  there" } });
    body.focus();
    body.setSelectionRange(6, 6);
    fireEvent.click(screen.getByRole("button", { name: /Insert Property \(\{\{propertyName\}\}\)/ }));
    expect(body.value).toBe("Hello {{propertyName}} there");
  });

  it("refuses to save when a required variable is missing", async () => {
    renderWorkspace();
    const body = await screen.findByLabelText("Inbox body");
    fireEvent.change(body, { target: { value: "Please finish your job." } });
    expect(screen.getByText("{{propertyName}} is required and missing.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save as v2/ })).toBeDisabled();
  });

  it("keeps the draft on a stale write and asks to load the current version explicitly", async () => {
    renderWorkspace();
    const title = await screen.findByLabelText("Inbox title");
    fireEvent.change(title, { target: { value: "Edited title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as v2" }));
    expect(await screen.findByText(/Changed since you opened it/)).toBeInTheDocument();
    expect(screen.getByLabelText("Inbox title")).toHaveValue("Edited title");
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(String(put[1].body))).toMatchObject({ kind: "EDIT", partId: "cleaner", transport: "INBOX", expectedHash: view.parts[0].liveHash });
  });

  it("shows a regenerated proposal beside the current wording; Use only fills the editor", async () => {
    renderWorkspace();
    await screen.findByLabelText("Inbox title");
    fireEvent.click(screen.getByRole("button", { name: "Regenerate wording" }));
    expect(await screen.findByRole("heading", { name: "Suggested wording" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use this wording" }));
    expect(screen.getByLabelText("Inbox title")).toHaveValue("Job not finished");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  it("is read-only with the reason when the user may not edit wording", async () => {
    view = manualReminderView({ canEdit: false, editReason: "Your access to Notifications is view only.", regenerate: { available: false, reason: "Your access to Notifications is view only." } });
    renderWorkspace();
    expect(await screen.findByLabelText("Inbox title")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Regenerate wording" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send test to me" })).toBeDisabled());
  });
});

describe("pure helpers", () => {
  it("insertVariable replaces a selection and returns the caret after the token", () => {
    expect(insertVariable("abcdef", 2, 4, "x")).toEqual({ value: "ab{{x}}ef", caret: 7 });
    expect(insertVariable("ab", null, null, "x")).toEqual({ value: "ab{{x}}", caret: 7 });
  });

  it("tab states disable transports with no wording and explain why", () => {
    const parts = manualReminderView().parts;
    expect(partsForTab(parts, "PUSH").map((part) => part.transport)).toEqual(["INBOX"]);
    const sms = tabStates(parts, ["INBOX", "EMAIL"]).find((tab) => tab.transport === "SMS")!;
    expect(sms).toMatchObject({ enabled: false, title: "Not sent by sms" });
  });

  it("row switch uses the existing type control or the single existing switch", () => {
    const base = { ...reminder, resolvedSwitches: [], respectsPreferencesNow: false, disabledTransports: [] as string[], externalPaths: {}, templateHref: null };
    const toggle = rowSwitch(base, null);
    expect(toggle.kind).toBe("toggle");
    if (toggle.kind === "toggle") expect(toggle.patch(false)).toEqual({ controls: { expectedUpdatedAt: null, disabledTransports: { [reminder.key]: reminder.transports } } });
    expect(transportTags(base).map((tag) => `${tag.key}:${tag.on}`)).toEqual(["In:true", "Push:true", "Email:false"]);
    const scheduled = NOTIFICATION_CATALOG.find((entry) => entry.key === "job.reminder.scheduled")!;
    expect(rowSwitch({ ...scheduled, resolvedSwitches: [{ id: "scheduled:reminder24hEnabled", label: "", enabled: true, editable: true, href: null, note: null }, { id: "scheduled:reminder2hEnabled", label: "", enabled: false, editable: true, href: null, note: null }], respectsPreferencesNow: null, disabledTransports: [], externalPaths: {}, templateHref: null }, null)).toEqual({ kind: "badge", label: "Partly on", tone: "warn" });
  });
});
