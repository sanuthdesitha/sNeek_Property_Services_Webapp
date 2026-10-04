import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FormsQaCentre } from "@/components/v2/admin/jobs/forms-qa-centre";
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/components/v2/shared/report-download-dialog", () => ({
  DownloadButton: ({ target }: any) => <button data-url={target.url}>Download {target.kind}</button>,
}));
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(["invalid-json", "missing-list", "null", "network"])("does not display zero damage reports for %s responses", async (failure) => {
  if (failure === "network") fetchMock.mockRejectedValue(new Error("Offline"));
  else fetchMock.mockResolvedValue({ ok: true, json: async () => {
    if (failure === "invalid-json") throw new Error("Invalid JSON");
    return failure === "null" ? null : {};
  } });
  render(<FormsQaCentre jobId="j" hasReport={false} hasQaReview={false} />); await flush();
  expect(screen.queryByText(/No formal damage reports/)).toBeNull();
  expect(screen.getByText(/Could not load damage reports|Offline|Invalid JSON|Cannot read/)).toBeVisible();
});

it("discards late reports from a previous job and only enables submitted-report downloads", async () => {
  let resolve!: (value: any) => void;
  fetchMock.mockReturnValueOnce(new Promise((done) => { resolve = done; })).mockResolvedValue({ ok: true, json: async () => ({ reports: [
    { id: "draft", status: "DRAFT", itemCount: 1, clientVisible: false, highestSeverity: "MINOR", reportedByName: "A Cleaner" },
    { id: "submitted", status: "SUBMITTED", itemCount: 2, clientVisible: true, highestSeverity: "MAJOR", reportedByName: null },
  ] }) });
  const view = render(<FormsQaCentre jobId="old" hasReport={false} hasQaReview={false} />);
  view.rerender(<FormsQaCentre jobId="new" hasReport={true} hasQaReview={true} />); await flush();
  resolve({ ok: true, json: async () => ({ reports: [] }) }); await flush();
  expect(screen.getByText("Draft — not submitted")).toBeVisible();
  expect(screen.getByText("Not released")).toBeVisible();
  expect(screen.getByText("Released")).toBeVisible();
  expect(screen.getByRole("button", { name: "Download DAMAGE" })).toHaveAttribute("data-url", "/api/damage/submitted/report");
  expect(screen.getAllByRole("link", { name: "Investigate" }).map((link) => link.getAttribute("href"))).toEqual(["/v2/admin/damage/draft", "/v2/admin/damage/submitted"]);
  expect(screen.queryByText(/No formal damage reports/)).toBeNull();
});

it("clears previous reports while loading the next job and exposes its failure", async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ reports: [] }) }).mockResolvedValueOnce({ ok: false, json: async () => ({ error: "No access to new job" }) });
  const view = render(<FormsQaCentre jobId="old" hasReport={false} hasQaReview={false} />); await flush();
  expect(screen.getByText(/No formal damage reports/)).toBeVisible();
  view.rerender(<FormsQaCentre jobId="new" hasReport={false} hasQaReview={false} />);
  expect(screen.queryByText(/No formal damage reports/)).toBeNull(); await flush();
  expect(screen.getByText("No access to new job")).toBeVisible();
});
