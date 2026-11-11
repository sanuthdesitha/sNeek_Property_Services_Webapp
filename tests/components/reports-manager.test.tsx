import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({ search: "q=glebe&visibility=client-hidden" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/v2/admin/reports",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { ReportsManager } from "@/components/v2/admin/reports/reports-manager";

const report = {
  id: "r1",
  jobId: "job-1",
  clientVisible: false,
  cleanerVisible: true,
  laundryVisible: false,
  sentToClient: false,
  job: {
    id: "job-1",
    jobNumber: "J-1",
    scheduledDate: "2026-10-04T13:00:00.000Z",
    jobType: "AIRBNB_TURNOVER",
    property: { id: "p1", name: "Glebe House", suburb: "Glebe", client: { name: "Northside Lets" } },
  },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/admin/report-themes")) return Response.json({ themes: [] });
    if (url.startsWith("/api/admin/reports?")) {
      return Response.json({ reports: [report], properties: [{ id: "p1", name: "Glebe House", suburb: "Glebe" }], pagination: { page: 1, limit: 25, totalCount: 1, totalPages: 1, hasMore: false } });
    }
    if (url.endsWith("/visibility")) return Response.json({ ok: true, body: init?.body });
    if (init?.method === "DELETE") return Response.json({ ok: true });
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("Client report PDFs manager", () => {
  it("reads an old link's filters from the URL into the list request", async () => {
    render(<ReportsManager />);
    await screen.findByText("Glebe House");
    const listCall = fetchMock.mock.calls.map((call) => String(call[0])).find((url) => url.startsWith("/api/admin/reports?"));
    expect(listCall).toContain("q=glebe");
    expect(listCall).toContain("visibility=client-hidden");
    expect(screen.getByDisplayValue("glebe")).toBeTruthy();
  });

  it("offers the laundry visibility toggle and sends laundryVisible", async () => {
    render(<ReportsManager />);
    fireEvent.click(await screen.findByRole("button", { name: /Hidden from laundry/ }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((entry) => String(entry[0]).endsWith("/visibility"));
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ laundryVisible: true });
    });
    expect(await screen.findByRole("button", { name: /Laundry sees it/ })).toBeTruthy();
  });

  it("confirms a delete through the shared confirmation modal before calling the API", async () => {
    render(<ReportsManager />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete report for Glebe House" }));
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === "DELETE")).toBe(false);
    expect(screen.getByText("Please confirm")).toBeTruthy();
    const confirm = screen.getAllByRole("button", { name: "Delete report" }).at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => call[1]?.method === "DELETE" && String(call[0]) === "/api/admin/reports/job-1")).toBe(true));
  });

  it("disables write controls for a read-only reports pack", async () => {
    render(<ReportsManager canManage={false} />);
    const row = (await screen.findByText("Glebe House")).closest("div.flex.flex-wrap") as HTMLElement;
    expect(within(row.parentElement as HTMLElement).getByRole("button", { name: /Hidden from laundry/ })).toHaveProperty("disabled", true);
    expect(screen.queryByText("Select all on this page")).toBeNull();
  });
});
