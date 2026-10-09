import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OperationsDisclosure } from "@/components/operations/ui";
import { LinenBags } from "@/components/operations/linen-bags";
import { TurnoverProfit } from "@/components/operations/turnover-profit";
import { PropertyCareWorkspace } from "@/components/property-care/workspace";
import { UrgentStockWorkspace } from "@/components/inventory/urgent-stock-workspace";
vi.mock("@/components/inventory/stay-preparation-panel", () => ({
  StayPreparationPanel: () => null,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const response = (body: unknown) => new Response(JSON.stringify(body));
const tasks = [
  { id: "a", property: "Alpha", job: "A" },
  { id: "b", property: "Beta", job: "B" },
];
const bag = (id: string) => ({
  bagId: id,
  version: 1,
  status: "REGISTERED",
  observedAt: "2026-10-03T16:30:00Z",
  recordedAt: "2026-10-03T16:35:00Z",
  source: "ADMIN_RECORDED",
  location: "Cupboard",
  contents: null,
  itemCount: null,
  note: "Observed label",
});
it("loads embedded custody on demand and preserves its draft when collapsed without a second page heading", async () => {
  const fetcher = vi.fn(async () => response({ tasks, events: [] }));
  vi.stubGlobal("fetch", fetcher);
  render(
    <>
      <h1>Laundry</h1>
      <OperationsDisclosure title="Individual bags">
        <LinenBags initialTaskId="a" role="ADMIN" panel />
      </OperationsDisclosure>
    </>,
  );
  expect(fetcher).not.toHaveBeenCalled();
  const toggle = screen.getByRole("button", { name: "Individual bags" });
  fireEvent.click(toggle);
  fireEvent.change(await screen.findByLabelText("Physical bag ID"), {
    target: { value: "KEEP-ME" },
  });
  fireEvent.click(toggle);
  expect(screen.getByLabelText("Physical bag ID")).not.toBeVisible();
  fireEvent.click(toggle);
  expect(screen.getByLabelText("Physical bag ID")).toHaveValue("KEEP-ME");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.queryByRole("main")).toBeNull();
});
it("ignores an old custody response even when its JSON body finishes after switching runs", async () => {
  const old = deferred<unknown>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("taskId=a")
        ? { ok: true, json: () => old.promise }
        : response({ tasks, events: [bag("B-BAG")] }),
    ),
  );
  render(<LinenBags role="ADMIN" />);
  await screen.findByText("B-BAG · Linked to run");
  fireEvent.change(screen.getByLabelText("Laundry run"), {
    target: { value: "a" },
  });
  expect(screen.queryByLabelText("Physical bag ID")).toBeNull();
  fireEvent.change(screen.getByLabelText("Laundry run"), {
    target: { value: "b" },
  });
  await screen.findByText("B-BAG · Linked to run");
  await act(async () => old.resolve({ tasks, events: [bag("A-BAG")] }));
  expect(screen.queryByText("A-BAG · Linked to run")).toBeNull();
  expect(screen.getByLabelText("Laundry run")).toHaveValue("b");
});
it("keeps failed custody input editable for an explicit retry and locks the run while saving", async () => {
  const save = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) =>
      options?.method === "POST"
        ? save.promise
        : response({ tasks, events: [] }),
    ),
  );
  render(<LinenBags initialTaskId="a" role="ADMIN" />);
  fireEvent.change(await screen.findByLabelText("Physical bag ID"), {
    target: { value: "KEEP" },
  });
  fireEvent.change(screen.getByLabelText("Observed at (your local time)"), {
    target: { value: "2026-10-04T08:00" },
  });
  fireEvent.change(
    screen.getByLabelText("Holder or location (write Unknown if uncertain)"),
    { target: { value: "Cupboard" } },
  );
  fireEvent.change(
    screen.getByLabelText("Observation note / evidence reference"),
    { target: { value: "Label checked" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Record bag observation" }),
  );
  expect(screen.getByLabelText("Laundry run")).toBeDisabled();
  expect(screen.getByLabelText("Physical bag ID")).toBeDisabled();
  await act(async () =>
    save.resolve(
      new Response(JSON.stringify({ error: "Connection failed" }), {
        status: 503,
      }),
    ),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Connection failed",
  );
  expect(screen.getByLabelText("Physical bag ID")).toHaveValue("KEEP");
  expect(screen.getByLabelText("Laundry run")).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Record bag observation" }),
  ).toBeEnabled();
});
it.each(["loading", "error"])(
  "does not label %s custody as an empty history",
  async (state) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        state === "loading"
          ? new Promise(() => {})
          : Promise.resolve(
              new Response(JSON.stringify({ error: "History unavailable" }), {
                status: 503,
              }),
            ),
      ),
    );
    render(<LinenBags initialTaskId="a" role="ADMIN" />);
    if (state === "error") await screen.findByRole("alert");
    expect(screen.queryByText(/No individual bag observations/)).toBeNull();
    expect(screen.queryByLabelText("Physical bag ID")).toBeNull();
  },
);
it("does not label unavailable stock as empty inventory, no reports, or no scheduled clean", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Supplies unavailable" }), {
          status: 503,
        }),
    ),
  );
  render(<UrgentStockWorkspace isAdmin initialPropertyId="p" />);
  await screen.findByRole("alert");
  expect(screen.queryByText(/No configured inventory/)).toBeNull();
  expect(screen.queryByText(/No reports for/)).toBeNull();
  expect(screen.queryByText(/No upcoming clean/)).toBeNull();
});
it("discards the previous property's form and late response when changing property context", async () => {
  const old = deferred<unknown>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("propertyId=a")
        ? { ok: true, json: () => old.promise }
        : response({ property: { name: "Beta" }, admin: false, tasks: [] }),
    ),
  );
  const { rerender } = render(<PropertyCareWorkspace propertyId="a" />);
  rerender(<PropertyCareWorkspace propertyId="b" />);
  await screen.findByText("Beta — memory and care");
  await act(async () =>
    old.resolve({ property: { name: "Alpha" }, admin: false, tasks: [] }),
  );
  expect(screen.queryByText("Alpha — memory and care")).toBeNull();
});
it("does not let a late cost response replace the selected turnover", async () => {
  const old = deferred<unknown>();
  const detail = (note: string) => ({
    note,
    revenue: { invoiced: null, cash: null, sources: [] },
    agreedPriceEstimate: null,
    documentedCostSubtotal: null,
    totalCost: null,
    profit: null,
    missingCosts: [],
    laundryRecordedCharge: null,
  });
  const jobs = tasks.map((t) => ({
    id: t.id,
    jobNumber: t.job,
    property: { name: t.property },
    scheduledDate: "2026-10-09",
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("jobId=a")
        ? { ok: true, json: () => old.promise }
        : response({ jobs, detail: detail("Beta costs") }),
    ),
  );
  render(<TurnoverProfit />);
  await screen.findByText("Beta costs");
  fireEvent.change(screen.getByLabelText("Turnover"), {
    target: { value: "a" },
  });
  fireEvent.change(screen.getByLabelText("Turnover"), {
    target: { value: "b" },
  });
  await screen.findByText("Beta costs");
  await act(async () => old.resolve({ jobs, detail: detail("Alpha costs") }));
  expect(screen.queryByText("Alpha costs")).toBeNull();
  expect(screen.getByLabelText("Turnover")).toHaveValue("b");
});
