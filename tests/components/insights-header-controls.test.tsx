import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ClientFilter, filterClients } from "@/components/v2/admin/insights/client-filter";
import { MonthlyEmailButton } from "@/components/v2/admin/insights/insights-page";
import { chosenPreviewOrder } from "@/components/v2/admin/insights/business-tab";

vi.mock("@/components/v2/admin/reports/reports-manager", () => ({ ReportsManager: () => null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn() }) }));

const CLIENTS = [
  { id: "c1", name: "Harbour View Stays" },
  { id: "c2", name: "Northside Lets" },
  { id: "c3", name: "North Shore Homes" },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubOptions(ok = true) {
  const fetch = vi.fn(async () => ({ ok, json: async () => (ok ? { access: { finance: true }, clients: CLIENTS } : { error: "Server down" }) }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("client filter chip", () => {
  it("matches any part of a client name, ignoring case and spaces at the ends", () => {
    expect(filterClients(CLIENTS, " north ").map((client) => client.id)).toEqual(["c2", "c3"]);
    expect(filterClients(CLIENTS, "")).toHaveLength(3);
    expect(filterClients(CLIENTS, "zzz")).toEqual([]);
  });

  it("reads 'Client: all', searches the database list and chooses by keyboard", async () => {
    stubOptions();
    const onChange = vi.fn();
    render(<ClientFilter value="" onChange={onChange} />);
    const chip = screen.getByRole("button", { name: "Client: all" });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    const search = await screen.findByLabelText("Search clients");
    fireEvent.change(search, { target: { value: "north" } });
    const list = screen.getByRole("list", { name: "Clients" });
    expect(within(list).getAllByRole("button").map((button) => button.textContent)).toEqual(["All clients", "Northside Lets", "North Shore Homes"]);

    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toHaveTextContent("All clients");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement).toHaveTextContent("Northside Lets");
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(document.activeElement).toHaveTextContent("North Shore Homes");
    fireEvent.click(document.activeElement as Element);
    expect(onChange).toHaveBeenCalledWith("c3");

    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(chip);
  });

  it("names the chosen client on the chip and keeps a way back when the list fails", async () => {
    stubOptions(false);
    const onChange = vi.fn();
    render(<ClientFilter value="c2" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Client: selected client" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Server down");
    fireEvent.click(screen.getByRole("button", { name: "Show all clients" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("Email monthly button", () => {
  it("shows the real state and opens the setting for an administrator", () => {
    render(<MonthlyEmailButton state={{ enabled: true, canConfigure: true }} />);
    const link = screen.getByRole("link", { name: /Email monthly\s*On/ });
    expect(link).toHaveAttribute("href", "/v2/admin/settings?tab=insights-email");
  });

  it("shows the state without a way in for anyone else, and nothing when the state is unknown", () => {
    const { container, rerender } = render(<MonthlyEmailButton state={{ enabled: false, canConfigure: false }} />);
    const button = screen.getByRole("button", { name: /Email monthly\s*Off.*administrator/ });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<MonthlyEmailButton state={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("preview order from the URL", () => {
  const columns = [{ key: "name", sortKey: "name", header: "Property", cell: () => null }, { key: "margin", sortKey: "margin", header: "Margin", cell: () => null }];

  it("uses only an order that names a preview column", () => {
    expect(chosenPreviewOrder(columns, "margin", "desc")).toEqual({ key: "margin", dir: "desc" });
    expect(chosenPreviewOrder(columns, "revenue", "desc")).toBeNull();
    expect(chosenPreviewOrder(columns, "name", "")).toBeNull();
    expect(chosenPreviewOrder(columns, "", "asc")).toBeNull();
  });
});
