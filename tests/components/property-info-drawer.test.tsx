import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PropertyInfoDrawer } from "@/components/v2/cleaner/property-info-drawer";

afterEach(() => vi.unstubAllGlobals());

function Harness({ forceClosed = false, onDismiss, images = false }: {
  forceClosed?: boolean; onDismiss?: () => void; images?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Property info</button>
    <button>Outside action</button>
    <PropertyInfoDrawer open={open && !forceClosed} onClose={() => { onDismiss?.(); setOpen(false); }}
      propertyId={images ? "test-property" : undefined}
      property={{ name: "Test property", address: "Test address",
        setupGuide: images ? [{ label: "Setup photo", images: [{ url: "/test-setup.png" }] }] : [] }}
      contact={null} readFirstItems={[]} restockNeeds={[]} />
  </>;
}

describe("Property info drawer focus", () => {
  it("names the modal, focuses inside and traps forward/backward Tab", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Property info" }));
    const dialog = screen.getByRole("dialog", { name: "Test property" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Close", exact: true })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Copy", exact: true })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Close", exact: true })).toHaveFocus();
    for (let i = 0; i < 4; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it.each(["Escape", "Close", "backdrop"])("restores the opener after %s dismissal and reopening", async (path) => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Property info" });
    for (let i = 0; i < 2; i++) {
      await user.click(opener);
      const dialog = screen.getByRole("dialog");
      if (path === "Escape") await user.keyboard("{Escape}");
      else if (path === "Close") await user.click(screen.getByRole("button", { name: "Close", exact: true }));
      else await user.click(dialog.previousElementSibling as HTMLElement);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(opener).toHaveFocus());
    }
  });

  it("restores focus when the parent closes the drawer", async () => {
    const user = userEvent.setup();
    const view = render(<Harness />);
    const opener = screen.getByRole("button", { name: "Property info" });
    await user.click(opener);
    view.rerender(<Harness forceClosed />);
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses the latest onClose callback without recapturing the opener", async () => {
    const user = userEvent.setup();
    const original = vi.fn();
    const latest = vi.fn();
    const view = render(<Harness onDismiss={original} />);
    const opener = screen.getByRole("button", { name: "Property info" });
    await user.click(opener);
    view.rerender(<Harness onDismiss={latest} />);
    await user.keyboard("{Escape}");
    expect(original).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("keeps real portalled media and access lightbox controls focusable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      accessGuide: [{ id: "door", kind: "ENTRY", label: "Test entrance", images: [
        { url: "/test-door.png", caption: "Door photo" },
        { url: "/test-key.png", caption: "Key photo" },
      ] }],
    }) }));
    const user = userEvent.setup();
    render(<Harness images />);
    const opener = screen.getByRole("button", { name: "Property info" });
    await user.click(opener);
    const outer = screen.getByRole("dialog", { name: "Test property" });
    await user.click(screen.getByRole("button", { name: /Setup photo/ }));
    const media = screen.getByRole("dialog", { name: "Setup photo" });
    expect(outer.contains(media)).toBe(false);
    expect(media.contains(document.activeElement)).toBe(true);
    await user.tab();
    expect(media.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Setup photo" })).toBeNull());
    expect(outer).toBeVisible();

    await user.click(await screen.findByRole("button", { name: /Test entrance/ }));
    await user.click(screen.getByRole("button", { name: "Door photo" }));
    const lightbox = screen.getByRole("dialog", { name: "Door photo" });
    expect(outer.contains(lightbox)).toBe(false);
    const next = within(lightbox).getByRole("button", { name: "Next", exact: true });
    for (let i = 0; i < 12 && document.activeElement !== next; i++) await user.tab();
    expect(next).toHaveFocus();
    await user.click(next);
    expect(next).toHaveFocus();
    expect(within(lightbox).getByRole("img", { name: "Key photo" })).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Key photo" })).toBeNull());
    expect(screen.getByRole("button", { name: "Door photo" })).toHaveFocus();
    expect(outer).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
