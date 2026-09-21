import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), settings: vi.fn(), portal: vi.fn(), tasks: vi.fn(), properties: vi.fn(), workspace: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/auth/client-portal", () => ({ requireClientPortalPage: m.auth }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/client/portal", () => ({ getClientPortalContext: m.portal }));
vi.mock("@/lib/client/portal-data", () => ({ listClientLaundryForUser: m.tasks, listClientPropertiesForUser: m.properties }));
vi.mock("@/lib/logger", () => ({ logger: { error: m.log } }));
vi.mock("@/components/v2/client/laundry/laundry-workspace", () => ({ LaundryWorkspace: (props: unknown) => { m.workspace(props); return <div>Authorized laundry workspace</div>; } }));
import Page from "@/app/v2/client/laundry/page";
import ErrorBoundary from "@/app/v2/client/laundry/error";
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ userId: "va-user", clientId: "client-account", userName: "Assistant" });
  m.settings.mockResolvedValue({}); m.portal.mockResolvedValue({ visibility: { showLaundryImages: true } });
  m.tasks.mockResolvedValue([{ id: "task" }]);
  m.properties.mockResolvedValue([{ id: "allowed-property", name: "House", address: "Private address", accessCode: "secret", clientId: "client-account" }]);
});
afterEach(cleanup);
it("loads tasks and property filters for the authorized caller and projects only property id/name", async () => {
  render(await Page());
  expect(m.auth).toHaveBeenCalledWith({ module: "laundry" });
  expect(m.tasks).toHaveBeenCalledWith("va-user"); expect(m.properties).toHaveBeenCalledWith("va-user");
  expect(m.portal).toHaveBeenCalledWith("va-user", {});
  expect(m.workspace).toHaveBeenCalledWith({ properties: [{ id: "allowed-property", name: "House" }], tasks: [{ id: "task" }], showLaundryImages: true });
});
it.each(["tasks", "properties"] as const)("propagates a %s query failure to the route error boundary", async source => {
  const failure = new Error("database unavailable"); m[source].mockRejectedValue(failure);
  await expect(Page()).rejects.toBe(failure);
  expect(m.workspace).not.toHaveBeenCalled();
});
it("fails closed for image permission when ancillary portal context is unavailable", async () => {
  m.portal.mockRejectedValue(new Error("visibility lookup failed"));
  render(await Page());
  expect(m.workspace).toHaveBeenCalledWith(expect.objectContaining({ showLaundryImages: false, tasks: [{ id: "task" }] }));
});
it("does not load any client data if the page authorization rejects", async () => {
  m.auth.mockRejectedValue(new Error("FORBIDDEN"));
  await expect(Page()).rejects.toThrow("FORBIDDEN");
  expect(m.tasks).not.toHaveBeenCalled(); expect(m.properties).not.toHaveBeenCalled();
});
it("renders an explicit retryable error instead of an empty schedule or internal exception", () => {
  const reset = vi.fn();
  render(<ErrorBoundary error={new Error("private database details")} reset={reset} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Laundry is unavailable");
  expect(screen.queryByText("private database details")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(reset).toHaveBeenCalledOnce();
});
