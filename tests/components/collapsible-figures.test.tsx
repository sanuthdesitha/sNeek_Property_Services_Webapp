/**
 * Owner decision 2026-11-13: below 640px the figure tiles fold behind one
 * "N figures · Show" disclosure; from 640px nothing changes (the button is
 * `sm:hidden`, the tiles' region is `sm:block` and always in the DOM). The
 * choice is remembered per tab for the session only.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CollapsibleFigures } from "@/components/v2/ui/collapsible-figures";
import { FactStrip } from "@/components/v2/admin/people/fact-strip";

const facts = Array.from({ length: 10 }, (_, index) => ({ key: `f${index}`, label: `Figure ${index}`, value: index }));

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CollapsibleFigures", () => {
  it("starts collapsed behind one labelled summary row, and opens and closes", () => {
    render(<FactStrip label="Client figures" facts={facts} collapsible={{ storageKey: "people:clients" }} />);
    const button = screen.getByRole("button", { name: "Client figures: 10 figures, show" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveTextContent("10 figures · Show");
    expect(button.className).toContain("sm:hidden");
    const region = document.getElementById(button.getAttribute("aria-controls")!)!;
    // Hidden on a phone, shown from 640px; the tiles stay in the DOM either way.
    expect(region.className).toBe("hidden sm:block");
    expect(region.querySelectorAll("section[aria-label='Client figures'] > div")).toHaveLength(10);
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveTextContent("10 figures · Hide");
    expect(region.className).toBe("mt-2 sm:mt-0");
    expect(window.sessionStorage.getItem("sneek:figures-open:people:clients")).toBe("1");
  });

  it("remembers the choice per tab for the session", () => {
    window.sessionStorage.setItem("sneek:figures-open:people:cleaners", "1");
    render(
      <>
        <CollapsibleFigures storageKey="people:cleaners" count={7} label="Cleaner figures"><p>tiles</p></CollapsibleFigures>
        <CollapsibleFigures storageKey="people:invitations" count={4} label="Account email figures"><p>tiles</p></CollapsibleFigures>
      </>,
    );
    expect(screen.getByRole("button", { name: /Cleaner figures/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Account email figures/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("works when session storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<CollapsibleFigures storageKey="quality:hub" count={6} label="Quality figures"><p>tiles</p></CollapsibleFigures>);
    const button = screen.getByRole("button", { name: /Quality figures/ });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("leaves the tiles' own markup untouched (desktop layout unchanged)", () => {
    const plain = renderToStaticMarkup(<FactStrip label="Client figures" facts={facts} />);
    const wrapped = renderToStaticMarkup(<FactStrip label="Client figures" facts={facts} collapsible={{ storageKey: "people:clients" }} />);
    expect(plain.startsWith("<section")).toBe(true);
    expect(wrapped).toContain(plain);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
