import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ESidePanel } from "@/components/v2/ui/side-panel";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open preview</button>
      <ESidePanel open={open} label="Job preview" title="The Bondi Studio" subtitle="Thu 12 Nov" onClose={() => setOpen(false)}
        toolbar={<a href="/v2/admin/jobs/job">Open full job</a>}>
        <button type="button">Inside</button>
      </ESidePanel>
    </>
  );
}

function setSheet(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}
afterEach(() => vi.unstubAllGlobals());

describe("ESidePanel", () => {
  it("is a labelled region that takes focus on open and returns it on Escape", async () => {
    setSheet(false);
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open preview" });
    opener.focus();
    fireEvent.click(opener);
    const panel = screen.getByRole("complementary", { name: "Job preview" });
    expect(panel).toHaveAccessibleDescription("The Bondi Studio");
    expect(screen.getByRole("heading", { level: 2, name: "The Bondi Studio" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "Inside" }), { key: "Escape" });
    expect(screen.queryByRole("complementary")).toBeNull();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("closes from its close button and returns focus", async () => {
    setSheet(false);
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open preview" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "Close job preview" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("becomes a modal sheet on a phone and keeps Tab inside it", () => {
    setSheet(true);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open preview" }));
    const sheet = screen.getByRole("dialog", { name: "Job preview" });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    const close = screen.getByRole("button", { name: "Close job preview" });
    const inside = screen.getByRole("button", { name: "Inside" });
    inside.focus();
    // jsdom has no layout; offsetParent is null, so the active element still counts.
    fireEvent.keyDown(inside, { key: "Tab" });
    expect(sheet.contains(document.activeElement)).toBe(true);
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(sheet.contains(document.activeElement)).toBe(true);
  });

  it("does not let an inner control's handled Escape close the panel", () => {
    setSheet(false);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open preview" }));
    const inside = screen.getByRole("button", { name: "Inside" });
    inside.addEventListener("keydown", (event) => event.preventDefault());
    fireEvent.keyDown(inside, { key: "Escape" });
    expect(screen.getByRole("complementary", { name: "Job preview" })).toBeVisible();
  });
});
