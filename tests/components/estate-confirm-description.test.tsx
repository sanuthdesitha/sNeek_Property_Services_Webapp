import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { EConfirmModal } from "@/components/v2/admin/estate-kit";
it("supports correction fields without nesting block content inside a paragraph", () => {
  render(<EConfirmModal open title="Reconcile invoice" onClose={vi.fn()} onConfirm={vi.fn()} description={<fieldset aria-label="Correction details"><label>Reason<input /></label></fieldset>} />);
  expect(screen.getByRole("group", { name: "Correction details" }).closest("p")).toBeNull();
});
