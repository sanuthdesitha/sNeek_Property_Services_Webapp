import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EBottomSheet } from "@/components/v2/ui/bottom-sheet";
import { EFilterBar } from "@/components/v2/ui/filter-bar";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { EFilterChips } from "@/components/v2/ui/filter-chips";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { EDataTable } from "@/components/v2/ui/data-table";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EPhoneActionBar, ESectionSwitcher } from "@/components/v2/ui/phone-bars";

/** Phone layout primitives (board "Admin phone", 2026-11). Below 640px = phone. */
function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.style.overflow = ""; });

describe("EBottomSheet", () => {
  it("is a labelled modal dialog that closes on Escape and returns focus, except while busy", async () => {
    function Harness({ busy }: { busy: boolean }) {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open sheet</button>
          <EBottomSheet open={open} onOpenChange={setOpen} title="Choose" busy={busy}><button type="button">Inside</button></EBottomSheet>
        </>
      );
    }
    const view = render(<Harness busy={false} />);
    const opener = screen.getByRole("button", { name: "Open sheet" });
    opener.focus();
    fireEvent.click(opener);
    const sheet = await screen.findByRole("dialog", { name: "Choose" });
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opener).toHaveFocus();
    view.rerender(<Harness busy />);
    fireEvent.click(opener);
    const busySheet = await screen.findByRole("dialog", { name: "Choose" });
    fireEvent.keyDown(busySheet, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Choose" })).toBeInTheDocument();
  });
});

function FilterHarness({ onClient }: { onClient: (value: string) => void }) {
  const [client, setClient] = useState("all");
  const [chip, setChip] = useState<"all" | "open">("all");
  const choose = (value: string) => { setClient(value); onClient(value); };
  return (
    <EFilterBar
      label="Filter invoices"
      active={client === "all" ? [] : [{ key: "client", label: `Client: ${client}`, onRemove: () => choose("all") }]}
      onClear={() => choose("all")}
      resultLabel="Show 4 invoices"
      tools={<button type="button">Columns</button>}
    >
      <EFilterChips label="Status" chips={[{ key: "all", label: "All" }, { key: "open", label: "Open", count: 3 }]} active={chip} onChange={setChip} />
      <EFilterPopover label="Client" value={client === "all" ? null : client}>
        <label>Client<select aria-label="Filter by client" value={client} onChange={(event) => choose(event.target.value)}>
          <option value="all">All clients</option><option value="Harbour">Harbour</option>
        </select></label>
      </EFilterPopover>
    </EFilterBar>
  );
}

describe("EFilterBar", () => {
  it("renders the controls inline from 640px up, with the display tools", () => {
    setPhone(false);
    render(<FilterHarness onClient={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Client" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Columns" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("collapses behind one Filter button on a phone and opens the same controls in a sheet", async () => {
    setPhone(true);
    const onClient = vi.fn();
    render(<FilterHarness onClient={onClient} />);
    expect(screen.queryByLabelText("Filter by client")).toBeNull();
    expect(screen.getByRole("button", { name: "Columns" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    const sheet = await screen.findByRole("dialog", { name: "Filter invoices" });
    // The popover becomes an open, labelled section; the chips stay a labelled group.
    expect(within(sheet).getByRole("group", { name: /Client/ })).toBeInTheDocument();
    expect(within(sheet).getByRole("group", { name: "Status" })).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText("Filter by client"), { target: { value: "Harbour" } });
    expect(onClient).toHaveBeenCalledWith("Harbour");
    fireEvent.click(within(sheet).getByRole("button", { name: "Show 4 invoices" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: /^Filter · 1/ })).toBeInTheDocument();
    const chips = screen.getByRole("list", { name: "Active filters" });
    fireEvent.click(within(chips).getByRole("button", { name: "Remove filter Client: Harbour" }));
    expect(onClient).toHaveBeenLastCalledWith("all");
    expect(screen.queryByRole("list", { name: "Active filters" })).toBeNull();
  });
});

describe("EBulkBar", () => {
  it("keeps every action mounted and reachable, with More revealing the rest on a phone", () => {
    const onClear = vi.fn();
    const actions = ["Assign cleaner", "Change status", "Reschedule", "Export selected"].map((label) => ({ label, onClick: vi.fn() }));
    render(
      <EBulkBar count={2} noun={{ one: "job", many: "jobs" }} onClear={onClear}>
        {actions.map((action) => <EBulkButton key={action.label} onClick={action.onClick}>{action.label}</EBulkButton>)}
      </EBulkBar>,
    );
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(bar.className).toContain("max-sm:fixed");
    for (const action of actions) {
      fireEvent.click(within(bar).getByRole("button", { name: action.label }));
      expect(action.onClick).toHaveBeenCalled();
    }
    const more = within(bar).getByRole("button", { name: /More/ });
    const third = within(bar).getByRole("button", { name: "Reschedule" }).parentElement!;
    expect(third.className).toContain("max-sm:hidden");
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(third.className).not.toContain("max-sm:hidden");
    fireEvent.click(within(bar).getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalled();
  });

  it("shows no More when two actions fit", () => {
    render(<EBulkBar count={1} noun={{ one: "item", many: "items" }} onClear={vi.fn()}><EBulkButton>Approve</EBulkButton><EBulkButton>Send</EBulkButton></EBulkBar>);
    expect(screen.queryByRole("button", { name: /More/ })).toBeNull();
  });
});

type Row = { id: string; name: string };
function TableHarness() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return (
    <EDataTable<Row>
      label="People"
      rows={[{ id: "a", name: "Aiko" }, { id: "b", name: "Jane" }]}
      rowKey={(row) => row.id}
      columns={[{ key: "role", header: "Role", cell: () => "Cleaner" }, { key: "name", header: "Name", phoneTitle: true, cell: (row) => row.name }]}
      selection={{ selected, onChange: setSelected, rowLabel: (row) => `Select ${row.name}` }}
    />
  );
}

describe("EDataTable phone select mode", () => {
  it("hides row checkboxes on a phone until Select, keeps selection semantics, and Cancel clears", () => {
    render(<TableHarness />);
    const checkbox = screen.getByRole("checkbox", { name: "Select Aiko" });
    expect(checkbox.closest("td")!.className).toContain("max-sm:hidden");
    fireEvent.click(screen.getByRole("button", { name: /^Select rows/ }));
    expect(checkbox.closest("td")!.className).not.toContain("max-sm:hidden");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all on this page" }));
    expect(screen.getByRole("checkbox", { name: "Select Jane" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /^Cancel/ }));
    expect(screen.getByRole("checkbox", { name: "Select Jane" })).not.toBeChecked();
    expect(checkbox.closest("td")!.className).toContain("max-sm:hidden");
  });

  it("uses the phoneTitle column as the card title", () => {
    render(<TableHarness />);
    const nameCell = screen.getByText("Aiko").closest("td")!;
    expect(nameCell.className).toContain("max-sm:order-first");
    expect(nameCell).not.toHaveAttribute("data-label");
  });
});

describe("dialogs and panels on a phone", () => {
  it("EActionDialog keeps its dialog semantics and becomes a bottom sheet below 640px", async () => {
    render(<EActionDialog open title="Send reminder" onClose={vi.fn()} footer={<button type="button">Send</button>}><p>Body</p></EActionDialog>);
    const dialog = await screen.findByRole("dialog", { name: "Send reminder" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.className).toContain("max-sm:rounded-t-[18px]");
  });

  it("ESidePanel shows a back arrow on a phone, locks the page and releases it on close", async () => {
    setPhone(true);
    function Harness() {
      const [open, setOpen] = useState(true);
      return <ESidePanel open={open} label="Job preview" title="The Bondi Studio" onClose={() => setOpen(false)}><p>Body</p></ESidePanel>;
    }
    render(<Harness />);
    expect(document.body.style.overflow).toBe("hidden");
    const back = screen.getByRole("button", { name: "Close job preview" });
    expect(back.className).toContain("max-sm:order-first");
    fireEvent.click(back);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("EPhoneActionBar and ESectionSwitcher", () => {
  it("renders the page action only on a phone, and not while hidden", () => {
    setPhone(false);
    const view = render(<EPhoneActionBar label="Jobs actions" primary={<a href="/v2/admin/jobs/new">New job</a>} />);
    expect(screen.queryByRole("region", { name: "Jobs actions" })).toBeNull();
    view.unmount();
    setPhone(true);
    const phone = render(<EPhoneActionBar label="Jobs actions" primary={<a href="/v2/admin/jobs/new">New job</a>} />);
    expect(within(screen.getByRole("region", { name: "Jobs actions" })).getByRole("link", { name: "New job" })).toBeInTheDocument();
    phone.rerender(<EPhoneActionBar label="Jobs actions" hidden primary={<a href="/v2/admin/jobs/new">New job</a>} />);
    expect(screen.queryByRole("region", { name: "Jobs actions" })).toBeNull();
  });

  it("jumps to a section and marks it current", () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <>
        <ESectionSwitcher label="Invoice sections" sections={[{ id: "lines", label: "Lines" }, { id: "checks", label: "Checks" }]} />
        <section id="lines">Lines</section><section id="checks">Checks</section>
      </>,
    );
    const nav = screen.getByRole("navigation", { name: "Invoice sections" });
    fireEvent.click(within(nav).getByRole("link", { name: "Checks" }));
    expect(within(nav).getByRole("link", { name: "Checks" })).toHaveAttribute("aria-current", "location");
    expect(document.getElementById("checks")).toHaveFocus();
  });
});
