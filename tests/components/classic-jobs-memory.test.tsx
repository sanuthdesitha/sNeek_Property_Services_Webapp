import { beforeEach, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { ClientJobsWorkspace } from "@/components/client/client-jobs-workspace";
vi.mock("next/navigation", () => ({ usePathname: () => "/client/jobs", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
beforeEach(() => { history.replaceState({}, "", "/client/jobs"); localStorage.clear(); });
const workspace = () => render(<ClientJobsWorkspace jobs={[]} showCleanerNames={false} showClientTaskRequests={false} showLaundryUpdates={false} />);
it("remembers the classic calendar and its month on return", () => {
  const first = workspace();
  fireEvent.click(screen.getByRole("button", { name: "Calendar", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  const month = screen.getByRole("button", { name: "Previous month" }).nextElementSibling!.textContent;
  first.unmount(); workspace();
  expect(screen.getByRole("button", { name: "Previous month" }).nextElementSibling!.textContent).toBe(month);
});
it("does not let the old cross-account persistent view override refreshed defaults", () => {
  localStorage.setItem("sneek_client_jobs_filter", JSON.stringify({ filterMode: "tomorrow", viewMode: "calendar" }));
  workspace();
  expect(screen.queryByRole("button", { name: "Next month" })).toBeNull();
});
