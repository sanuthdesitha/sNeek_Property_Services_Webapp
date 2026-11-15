/**
 * Shelf labels (board "Shelf labels", 2026-11-17): three steps; "Already
 * labelled here" before Make (and not tickable); Make posts only the new
 * items, then "Made just now" labels come ticked for printing; a failed Make
 * keeps the ticks; changing the place clears both ticks, keeps the search and
 * ignores a late answer; a failed read shows nothing rather than an empty
 * list; step 3 is hidden with no labels; Print is off with nothing ticked;
 * the preview is A4 pages (21 per page, 3 across).
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("jsbarcode", () => ({ default: vi.fn() }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,AAAA") } }));

import { LabelManager } from "@/components/v2/admin/inventory/label-manager";
import { LABELS_PER_SHEET, labelPages, labelPlaceLine } from "@/components/v2/inventory/label-sheet";

type Pending = { url: string; init: RequestInit; resolve: (body: unknown, status?: number) => void };
let calls: Pending[];

const PROPERTIES = [{ id: "p-bondi", name: "Bondi Beach House" }, { id: "p-coogee", name: "Coogee Terrace" }];
const ITEMS = [
  { id: "i-tp", name: "Toilet paper, 2-ply", category: "Paper", unit: "roll" },
  { id: "i-cloth", name: "Microfibre cloths", category: "Cleaning", unit: "pack of 10" },
  { id: "i-dish", name: "Dishwasher tablets", category: "Kitchen", unit: "box" },
];

function label(id: string, itemId: string, code: string, propertyName = "Bondi Beach House") {
  const item = ITEMS.find((row) => row.id === itemId)!;
  return { id, code, packSize: 1, isActive: true, item: { id: item.id, name: item.name, unit: item.unit, category: item.category }, property: { id: "p-bondi", name: propertyName, suburb: "Bondi" } };
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => new Promise((resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    calls.push({ url, init, resolve: (body, status = 200) => resolve({ ok: status < 400, status, json: async () => body }) });
  })));
});
afterEach(() => vi.unstubAllGlobals());

async function answer(call: Pending | undefined, body: unknown, status = 200) {
  if (!call) throw new Error("No such call");
  await act(async () => { call.resolve(body, status); });
}
const labelReads = () => calls.filter((call) => call.url.startsWith("/api/admin/inventory/labels?"));
const itemReads = () => calls.filter((call) => call.url === "/api/admin/inventory/items");

async function openOnBondi(labels: unknown[]) {
  render(<LabelManager properties={PROPERTIES} />);
  await answer(labelReads()[0], { labels: [] });
  await answer(itemReads()[0], ITEMS);
  fireEvent.change(screen.getByLabelText("Where the label goes"), { target: { value: "p-bondi" } });
  const reads = labelReads();
  await answer(reads[reads.length - 1], { labels });
  const items = itemReads();
  await answer(items[items.length - 1], ITEMS);
}

describe("step 1: make labels", () => {
  it("marks items already labelled here before Make, and they cannot be ticked", async () => {
    await openOnBondi([label("l-dish", "i-dish", "SNK-4LMQ7PXD")]);
    const row = within(screen.getByRole("list", { name: "Items" })).getByText("Dishwasher tablets").closest("label") as HTMLElement;
    expect(within(row).getByText("Already labelled here")).toBeInTheDocument();
    expect(within(row).getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Make labels" })).toBeDisabled();
  });

  it("posts only the ticked new items, then tags them Made just now and ticks them for printing", async () => {
    await openOnBondi([label("l-dish", "i-dish", "SNK-4LMQ7PXD")]);
    fireEvent.click(within(screen.getByText("Toilet paper, 2-ply").closest("label") as HTMLElement).getByRole("checkbox"));
    fireEvent.click(within(screen.getByText("Microfibre cloths").closest("label") as HTMLElement).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Make 2 labels" }));
    const post = calls.find((call) => call.init.method === "POST");
    expect(JSON.parse(String(post?.init.body))).toEqual({ itemIds: ["i-tp", "i-cloth"], propertyId: "p-bondi" });
    // Fields and the place are frozen while making.
    expect(screen.getByLabelText("Where the label goes")).toBeDisabled();
    await answer(post, { created: [{ id: "l-tp" }, { id: "l-cloth" }], skipped: 0 }, 201);
    expect(screen.getByText("2 labels made and ticked for printing.")).toHaveAttribute("role", "status");
    const reads = labelReads();
    await answer(reads[reads.length - 1], { labels: [label("l-tp", "i-tp", "SNK-7KQ4M2XA"), label("l-cloth", "i-cloth", "SNK-H3WP9TRC"), label("l-dish", "i-dish", "SNK-4LMQ7PXD")] });
    const items = itemReads();
    await answer(items[items.length - 1], ITEMS);
    const list = screen.getByRole("list", { name: "Labels" });
    expect(within(list).getAllByText("Made just now")).toHaveLength(2);
    expect(within(within(list).getByText("Microfibre cloths").closest("label") as HTMLElement).getByRole("checkbox")).toBeChecked();
    expect(within(within(list).getByText("Dishwasher tablets").closest("label") as HTMLElement).getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Print 2" })).toBeEnabled();
    expect(screen.getByRole("group", { name: "Print preview: 1 A4 page" })).toBeInTheDocument();
  });

  it("a failed Make keeps the ticks and says nothing was made", async () => {
    await openOnBondi([]);
    fireEvent.click(within(screen.getByText("Toilet paper, 2-ply").closest("label") as HTMLElement).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Make 1 label" }));
    await answer(calls.find((call) => call.init.method === "POST"), { error: "The labels were not made." }, 500);
    expect(screen.getByRole("alert")).toHaveTextContent("The labels were not made. Your 1 ticked item is still ticked");
    expect(within(screen.getByText("Toilet paper, 2-ply").closest("label") as HTMLElement).getByRole("checkbox")).toBeChecked();
  });
});

describe("scope and states", () => {
  it("changing the place clears the ticks, keeps the search and ignores a late answer", async () => {
    await openOnBondi([label("l-dish", "i-dish", "SNK-4LMQ7PXD")]);
    fireEvent.change(screen.getByLabelText("Find an item"), { target: { value: "cloth" } });
    fireEvent.click(within(screen.getByText("Microfibre cloths").closest("label") as HTMLElement).getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Where the label goes"), { target: { value: "p-coogee" } });
    const coogee = labelReads()[labelReads().length - 1];
    fireEvent.change(screen.getByLabelText("Where the label goes"), { target: { value: "p-bondi" } });
    expect(coogee.init.signal?.aborted).toBe(true);
    await answer(coogee, { labels: [label("l-late", "i-cloth", "SNK-LATE0000", "Coogee Terrace")] });
    expect(screen.queryByText("SNK-LATE0000")).not.toBeInTheDocument();
    const reads = labelReads();
    await answer(reads[reads.length - 1], { labels: [] });
    const items = itemReads();
    await answer(items[items.length - 1], ITEMS);
    expect(screen.getByLabelText("Find an item")).toHaveValue("cloth");
    expect(within(screen.getByText("Microfibre cloths").closest("label") as HTMLElement).getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByText("No labels for Bondi Beach House yet. Tick items in step 1 and make them.")).toBeInTheDocument();
    // Step 3 is hidden while there are no labels for the place.
    expect(screen.queryByRole("heading", { name: /Step 3/ })).not.toBeInTheDocument();
  });

  it("a failed read shows nothing rather than an empty list", async () => {
    render(<LabelManager properties={PROPERTIES} />);
    await answer(labelReads()[0], { error: "nope" }, 500);
    await answer(itemReads()[0], ITEMS);
    expect(screen.getByRole("alert")).toHaveTextContent("Labels could not be loaded.");
    expect(screen.queryByText(/No labels for/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make labels" })).toBeDisabled();
  });

  it("Print is off with nothing ticked and the preview says what to do", async () => {
    await openOnBondi([label("l-dish", "i-dish", "SNK-4LMQ7PXD")]);
    expect(screen.getByRole("button", { name: "Print" })).toBeDisabled();
    expect(screen.getByText("Tick labels in step 2 to see them here.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Barcode" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Many per page" })).toBeChecked();
  });
});

describe("label pages", () => {
  it("puts 21 on a sheet (3 across, 7 down) and one per page when asked", () => {
    const labels = Array.from({ length: 22 }, (_, index) => index);
    expect(LABELS_PER_SHEET).toBe(21);
    expect(labelPages(labels, "sheet").map((page) => page.length)).toEqual([21, 1]);
    expect(labelPages(labels.slice(0, 3), "single")).toHaveLength(3);
    expect(labelPlaceLine({ propertyName: "Bondi Beach House", unit: "roll" })).toBe("Bondi Beach House · roll");
    expect(labelPlaceLine({ propertyName: null, unit: null })).toBe("Any property");
  });
});
