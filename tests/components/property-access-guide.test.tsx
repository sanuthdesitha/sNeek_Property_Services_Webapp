import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PropertyAccessGuide from "@/components/v2/cleaner/property-access-guide";
import { PropertyInfoDrawer } from "@/components/v2/cleaner/property-info-drawer";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    accessGuide: [{ id: "entry", kind: "ENTRY", label: "Test entrance", images: [
      { url: "/door.png", caption: "Door photo" }, { url: "/key.png", caption: "Key photo" },
    ] }],
  }) }));
});
afterEach(() => vi.unstubAllGlobals());

function Harness({ nested }: { nested: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Property info</button>
    <button>Background action</button>
    {nested ? <PropertyInfoDrawer open={open} onClose={() => setOpen(false)}
      property={{ name: "Test property" }} propertyId="test" contact={null}
      readFirstItems={[]} restockNeeds={[]} /> : <PropertyAccessGuide propertyId="test" />}
  </>;
}

describe.each([false, true])("Access lightbox (nested=%s)", (nested) => {
  it.each(["Escape", "Close", "backdrop"])("traps, names and restores focus on %s", async (dismissal) => {
    const user = userEvent.setup();
    render(<Harness nested={nested} />);
    const propertyTrigger = screen.getByRole("button", { name: "Property info" });
    if (nested) await user.click(propertyTrigger);
    await user.click(await screen.findByRole("button", { name: /Test entrance/ }));
    const thumbnail = screen.getByRole("button", { name: "Door photo" });
    for (let cycle = 0; cycle < 2; cycle++) {
      await user.click(thumbnail);
      const modal = screen.getByRole("dialog", { name: "Door photo" });
      expect(modal).toHaveAttribute("aria-modal", "true");
      expect(screen.queryByRole("button", { name: "Background action" })).toBeNull();
      const close = within(modal).getByRole("button", { name: "Close" });
      expect(close).toHaveFocus();
      await user.tab({ shift: true });
      expect(within(modal).getByRole("button", { name: "Photo 2" })).toHaveFocus();
      await user.tab();
      expect(close).toHaveFocus();
      for (let i = 0; i < 7; i++) {
        await user.tab();
        expect(modal.contains(document.activeElement)).toBe(true);
      }
      if (dismissal === "Escape") await user.keyboard("{Escape}");
      else if (dismissal === "Close") await user.click(close);
      else await user.click(modal);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Door photo" })).toBeNull());
      await waitFor(() => expect(thumbnail).toHaveFocus());
      if (nested) expect(screen.getByRole("dialog", { name: "Test property" })).toBeVisible();
    }
    if (nested) {
      await user.keyboard("{Escape}");
      await waitFor(() => expect(propertyTrigger).toHaveFocus());
    }
  });

  it("preserves arrow/button/thumbnail navigation without dismissing", async () => {
    const user = userEvent.setup();
    render(<Harness nested={nested} />);
    if (nested) await user.click(screen.getByRole("button", { name: "Property info" }));
    await user.click(await screen.findByRole("button", { name: /Test entrance/ }));
    await user.click(screen.getByRole("button", { name: "Door photo" }));
    const modal = screen.getByRole("dialog", { name: "Door photo" });
    await user.keyboard("{ArrowLeft}");
    expect(modal).toHaveAccessibleName("Key photo");
    await user.keyboard("{ArrowRight}");
    expect(modal).toHaveAccessibleName("Door photo");
    await user.click(within(modal).getByRole("button", { name: "Next", exact: true }));
    expect(modal).toHaveAccessibleName("Key photo");
    await user.click(within(modal).getByRole("button", { name: "Previous", exact: true }));
    await user.click(within(modal).getByRole("button", { name: "Photo 2" }));
    await user.click(within(modal).getByRole("img", { name: "Key photo" }));
    expect(modal).toHaveAccessibleName("Key photo");
    expect(modal).toBeVisible();
  });
});
