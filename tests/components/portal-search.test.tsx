import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortalSearch } from "@/components/v2/portal/portal-search";

const auth = vi.hoisted(() => ({ status: "authenticated", user: { id: "alice", role: "CLIENT" } }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: auth.status, data: { user: auth.user } }) }));
const fetchMock = vi.fn();
const nav = [{ href: "/v2/client/calendar", label: "Calendar" }];
const response = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body });
const payload = { groups: [{ id: "jobs", label: "Jobs", items: [{ id: "job-1", label: "Harbour clean", href: "/v2/client/jobs/job-1" }] }] };
const open = () => fireEvent.click(screen.getByRole("button", { name: "Search portal", exact: true }));
beforeEach(() => {
  auth.status = "authenticated"; auth.user = { id: "alice", role: "CLIENT" };
  fetchMock.mockReset().mockResolvedValue(response(payload));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("portal record search", () => {
  it("opens with Control+K and restores the previous field without nesting in another dialog", async () => {
    const user = userEvent.setup();
    const view = render(<><input aria-label="Work note" /><PortalSearch accent="client" nav={nav} /></>);
    const field = screen.getByRole("textbox", { name: "Work note" });
    await user.click(field);
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(field).toHaveFocus());
    view.rerender(<><div role="dialog" aria-label="Other work">Other work</div><PortalSearch accent="client" nav={nav} /></>);
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("fetches only on opening and displays scoped pages and grouped record destinations", async () => {
    render(<PortalSearch accent="client" nav={nav} />);
    expect(fetchMock).not.toHaveBeenCalled();
    open();
    expect(await screen.findByRole("link", { name: "Harbour clean" })).toHaveAttribute("href", "/v2/client/jobs/job-1");
    expect(screen.getByRole("link", { name: "Calendar" })).toBeVisible();
    expect(screen.queryByText("Payroll")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/portal/search?q=", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  });

  it("debounces rapid query changes and clears old results immediately", async () => {
    render(<PortalSearch accent="client" nav={nav} />); open();
    await screen.findByRole("link", { name: "Harbour clean" });
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "H" } });
    fireEvent.change(input, { target: { value: "Harbour & 2" } });
    expect(screen.queryByRole("link", { name: "Harbour clean" })).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/portal/search?q=Harbour%20%26%202");
  });

  it("preserves a truthful error and retries instead of displaying an empty search", async () => {
    fetchMock.mockResolvedValueOnce(response({}, 503));
    render(<PortalSearch accent="client" nav={nav} />); open();
    await screen.findByRole("alert");
    expect(screen.queryByText("No matching records or pages.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "Harbour clean" })).toBeVisible();
  });

  it("hides results and stale pages after denial until a successful refresh", async () => {
    fetchMock.mockResolvedValueOnce(response({}, 403)).mockResolvedValueOnce(response({}, 503));
    render(<PortalSearch accent="client" nav={nav} />); open();
    await screen.findByRole("alert");
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Could not load record results.");
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "Calendar" })).toBeVisible();
  });

  it.each(["https://evil.invalid", "//evil.invalid", "/v2/client/\\evil", "/v2/client/%0aevil"])("rejects unsafe destination %s", async href => {
    fetchMock.mockResolvedValue(response({ groups: [{ id: "jobs", label: "Jobs", items: [{ id: "x", label: "Unsafe", href }] }] }));
    render(<PortalSearch accent="client" nav={[]} />); open();
    await screen.findByRole("alert");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("aborts on identity change and ignores an old response", async () => {
    let finish!: (value: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = render(<PortalSearch accent="client" nav={nav} />); open();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = fetchMock.mock.calls[0][1].signal;
    auth.user = { id: "bob", role: "CLIENT" };
    view.rerender(<PortalSearch accent="client" nav={nav} />);
    expect(signal.aborted).toBe(true);
    await act(async () => finish(response(payload)));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("supports keyboard focus trapping and Escape restoration", async () => {
    const user = userEvent.setup();
    render(<PortalSearch accent="client" nav={nav} />);
    const trigger = screen.getByRole("button", { name: "Search portal" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Search portal" });
    await screen.findByRole("link", { name: "Harbour clean" });
    for (let i = 0; i < 7; i++) { await user.tab(); expect(dialog.contains(document.activeElement)).toBe(true); }
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it.each(["loading", "unauthenticated"])("does not expose search while %s", status => {
    auth.status = status;
    render(<PortalSearch accent="client" nav={nav} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
