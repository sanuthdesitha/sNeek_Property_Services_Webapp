import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalSwitchesPanel } from "@/components/v2/notifications/personal-switches-panel";
import type { PersonalSwitchesView, SwitchCell } from "@/lib/notifications/personal/view-types";

/**
 * The shared switches panel: shows the office's switches as office decisions,
 * who changed a switch, freezes while saving, keeps a failed change for
 * "Try again", shows the current switches when someone else changed them,
 * and never lets a late answer for another person populate the screen.
 */
function cell(id: string, label: string, overrides: Partial<SwitchCell> = {}): SwitchCell {
  return { id, transport: null, label, on: true, editable: true, officeOff: null, unavailable: null, coveredBy: null, changed: null, ...overrides };
}

function view(overrides: Partial<PersonalSwitchesView> = {}): PersonalSwitchesView {
  return {
    subject: { kind: "CLIENT", id: "client-1", name: "Harbour Stays", role: "CLIENT", hasEmail: true, hasPhone: false },
    revision: 4,
    timeZone: "Australia/Sydney",
    master: cell("all", "All notifications", { changed: { byName: "Ada Admin", byRole: "ADMIN", at: "2026-11-20T23:30:00.000Z" } }),
    transports: [cell("transport:APP", "All in the app", { transport: "APP" }), cell("transport:EMAIL", "All email", { transport: "EMAIL" }), cell("transport:SMS", "All text", { transport: "SMS", unavailable: "No mobile number on file." })],
    jobEvents: [cell("event:enRoute", "Cleaner on the way"), cell("event:started", "Clean started"), cell("event:finished", "Clean finished, report ready")],
    groups: [{
      label: "Repairs and damage",
      rows: [{
        key: "office.cases", name: "Case created, updated or followed up", trigger: "A case changes", fixed: null, fixedText: null, officeNote: null,
        cells: [cell("type:office.cases:APP", "In the app", { transport: "APP" }), cell("type:office.cases:EMAIL", "Email", { transport: "EMAIL", officeOff: "Switched off by the office: this automatic email is off." })],
      }],
    }, {
      label: "Your cleans",
      rows: [{ key: "client.job_updates", name: "Client job updates", trigger: "On the way", fixed: null, fixedText: null, officeNote: null, cells: [cell("type:client.job_updates:EMAIL", "Email", { transport: "EMAIL" }), cell("type:client.job_updates:SMS", "Text", { transport: "SMS", on: false })] }],
    }],
    topics: null,
    account: null,
    logins: [],
    offCount: 1,
    canEdit: true,
    readOnlyReason: null,
    ...overrides,
  };
}

const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("personal switches panel", () => {
  it("shows the office's switch as the office's, the missing phone and who changed a switch", async () => {
    fetchMock.mockResolvedValue(ok(view()));
    render(<PersonalSwitchesPanel source={{ kind: "self" }} title="Service updates" />);
    expect(await screen.findByRole("switch", { name: "Enable notifications" })).toBeChecked();
    expect(screen.getByText(/Changed by Ada Admin/)).toBeInTheDocument();
    expect(screen.getByText("No mobile number on file.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Choose each notification"));
    expect(await screen.findByText("Switched off by the office: this automatic email is off.")).toBeInTheDocument();
    expect(screen.getByText(/sign-in codes, password resets/)).toBeInTheDocument();
  });

  it("saves a switch with the revision, freezes while saving, keeps a failed change for Try again", async () => {
    fetchMock.mockResolvedValueOnce(ok(view()));
    let finish: (value: unknown) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<PersonalSwitchesPanel source={{ kind: "self" }} />);
    const master = await screen.findByRole("switch", { name: "Enable notifications" });
    fireEvent.click(master);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ revision: 4, changes: [{ id: "all", on: false }] });
    expect(screen.getByRole("switch", { name: "Clean started" })).toBeDisabled();
    await act(async () => finish(ok({ error: "Database busy" }, 500)));
    expect(await screen.findByText(/Not saved: Database busy/)).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(ok(view({ revision: 5, master: cell("all", "All notifications", { on: false }) })));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Enable notifications" })).not.toBeChecked());
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ revision: 4, changes: [{ id: "all", on: false }] });
  });

  it("someone else's change: shows the current switches and offers to apply mine again", async () => {
    fetchMock.mockResolvedValueOnce(ok(view()));
    fetchMock.mockResolvedValueOnce(ok({ error: "Changed by someone else.", code: "STALE", current: view({ revision: 9, offCount: 2 }) }, 409));
    render(<PersonalSwitchesPanel source={{ kind: "admin-client", clientId: "client-1" }} />);
    fireEvent.click(await screen.findByRole("switch", { name: "Clean started" }));
    expect(await screen.findByRole("button", { name: "Apply my change again" })).toBeInTheDocument();
    expect(screen.getByText("(2 off)")).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(ok(view({ revision: 10 })));
    fireEvent.click(screen.getByRole("button", { name: "Apply my change again" }));
    await waitFor(() => expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ revision: 9, changes: [{ id: "event:started", on: false }] }));
  });

  it("the channel choice sends both cells, switching on first", async () => {
    fetchMock.mockResolvedValueOnce(ok(view()));
    fetchMock.mockResolvedValueOnce(ok(view({ revision: 5 })));
    render(<PersonalSwitchesPanel source={{ kind: "self" }} />);
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "SMS" } });
    await waitFor(() => expect(JSON.parse(fetchMock.mock.calls[1][1].body).changes).toEqual([
      { id: "type:client.job_updates:SMS", on: true },
      { id: "type:client.job_updates:EMAIL", on: false },
    ]));
  });

  it("a late answer for the previous person never fills the screen for the next one", async () => {
    let finishFirst: (value: unknown) => void = () => undefined;
    fetchMock.mockImplementationOnce((_url: string, init: { signal: AbortSignal }) => new Promise((resolve) => {
      finishFirst = resolve;
      init.signal.addEventListener("abort", () => undefined);
    }));
    fetchMock.mockResolvedValueOnce(ok(view({ subject: { kind: "USER", id: "cleaner-2", name: "Second Person", role: "CLEANER", hasEmail: true, hasPhone: true }, jobEvents: null })));
    const { rerender } = render(<PersonalSwitchesPanel source={{ kind: "admin", userId: "cleaner-1" }} />);
    rerender(<PersonalSwitchesPanel source={{ kind: "admin", userId: "cleaner-2" }} />);
    expect(await screen.findByRole("switch", { name: "All notifications" })).toBeInTheDocument();
    await act(async () => finishFirst(ok(view())));
    expect(screen.queryByRole("switch", { name: "Enable notifications" })).toBeNull();
  });

  it("read-only for an operations manager or while testing as someone else", async () => {
    fetchMock.mockResolvedValue(ok(view({ canEdit: false, readOnlyReason: "Only an administrator can change someone else's notification switches.", master: cell("all", "All notifications", { editable: false }) })));
    render(<PersonalSwitchesPanel source={{ kind: "admin-client", clientId: "client-1" }} />);
    expect(await screen.findByText(/Only an administrator/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable notifications" })).toBeDisabled();
  });
});
