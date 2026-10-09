import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JobStatusProgress } from "@/components/shared/job-status-progress";
import { JobStatusIcon } from "@/components/shared/job-status-icon";

describe("Vector job progress", () => {
  it.each(["PAUSED", "WAITING_CONTINUATION_APPROVAL"])("keeps %s in Cleaning without claiming completion", status => {
    const { container } = render(<JobStatusProgress status={status} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");
    expect(container.querySelector('[aria-current="step"]')).toHaveTextContent("Cleaning");
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(container.querySelectorAll('[data-reached="true"]')).toHaveLength(4);
  });
  it("updates the actual stage and vector when status changes", () => {
    const { rerender, container } = render(<JobStatusProgress status="EN_ROUTE" />);
    expect(container.querySelector('[data-motion="travel"]')).not.toBeNull();
    rerender(<JobStatusProgress status="IN_PROGRESS" />);
    expect(container.querySelector('[data-motion="travel"]')).toBeNull();
    expect(container.querySelector('[data-motion="clean"]')).not.toBeNull();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");
  });
  it("does not invent a milestone for an unknown status", () => {
    render(<JobStatusProgress status="UNKNOWN" />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText("Job status: UNKNOWN")).toBeVisible();
  });
  it("keeps paused icons static and vectors decorative", () => {
    const { container } = render(<JobStatusIcon status="PAUSED" />);
    expect(container.firstChild).toHaveAttribute("data-motion", "paused");
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });
});
