import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { JobDisclosure } from "@/components/v2/admin/jobs/detail/job-disclosure";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("job stage disclosure", () => {
  it("mounts its tool only when first opened", () => {
    render(<JobDisclosure id="billing" label="Billing and pay ledger"><input aria-label="Fixed price" /></JobDisclosure>);
    expect(screen.queryByLabelText("Fixed price")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Billing and pay ledger/ }));
    expect(screen.getByLabelText("Fixed price")).toBeVisible();
  });

  it("keeps a draft when collapsed and reopened", () => {
    render(<JobDisclosure id="scope-edit" label="Edit scope and notes"><input aria-label="Note" /></JobDisclosure>);
    const toggle = screen.getByRole("button", { name: /Edit scope and notes/ });
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Owner visiting Friday" } });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByLabelText("Note")).toHaveValue("Owner visiting Friday");
  });

  it("opens when the URL hash names it (rail 'Edit billing', old ?tab=money)", () => {
    render(<JobDisclosure id="billing" label="Billing and pay ledger"><p>Ledger</p></JobDisclosure>);
    act(() => {
      window.history.replaceState(null, "", "/#billing");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("button", { name: /Billing and pay ledger/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Ledger")).toBeVisible();
  });
});
