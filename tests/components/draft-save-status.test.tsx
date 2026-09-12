import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DraftSaveStatus } from "@/components/v2/cleaner/draft-save-status";
describe("draft save status", () => {
  it("offers an explicit retry after failure", () => {
    const retry = vi.fn();
    render(<DraftSaveStatus state={{ phase: "error", message: "Draft not saved." }} onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Draft not saved.");
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("distinguishes pending work from confirmation", () => {
    const view = render(<DraftSaveStatus state={{ phase: "saving" }} onRetry={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Saving draft...");
    view.rerender(<DraftSaveStatus state={{ phase: "saved" }} onRetry={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Draft save confirmed");
  });
});
