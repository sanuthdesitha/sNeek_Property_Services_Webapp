import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobDialog } from "@/components/v2/admin/jobs/job-dialog";

function Harness({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Open assignment</button>
    <button>Outside action</button>
    <JobDialog open={open} busy={busy} title="Assign cleaners" onClose={() => setOpen(false)}>
      <label>Cleaner<input /></label>
      <button>Assign</button>
    </JobDialog>
  </>;
}

describe("Jobs dialog", () => {
  it("names the modal, traps focus and restores the opener on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open assignment" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Assign cleaners" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("data-skin", "estate");
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opener).toHaveFocus();
  });

  it("closes with its accessible Close control and restores focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open assignment" }));
    await user.click(screen.getByRole("button", { name: "Close", exact: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Open assignment" })).toHaveFocus();
  });

  it("blocks dismissal while the request is in flight and re-enables it afterward", async () => {
    const user = userEvent.setup();
    const view = render(<Harness busy />);
    await user.click(screen.getByRole("button", { name: "Open assignment" }));
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeVisible();
    view.rerender(<Harness busy={false} />);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("bounds tall content and disables nonessential motion for reduced-motion users", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open assignment" }));
    expect(screen.getByRole("dialog")).toHaveClass("overflow-y-auto", "motion-reduce:animate-none");
  });
});
