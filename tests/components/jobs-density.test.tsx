import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EJobRow, EBoardCard } from "@/components/v2/admin/jobs/job-row";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const props = { job: { id: "synthetic", property: { name: "Long property name with readable width", client: { name: "Client" } }, status: "COMPLETED" },
  selected: false, onToggleSelect: vi.fn(), onQuickAssign: vi.fn() };

describe("Jobs-only density", () => {
  it.each([
    ["compact", "py-2"], ["default", "py-3"], ["comfortable", "py-5"],
  ] as const)("renders %s rows without replacing the responsive grid", (density, padding) => {
    const { container } = render(<EJobRow {...props} density={density} />);
    expect(screen.getByRole("link")).toHaveClass("e-job-row", "grid", padding);
    expect(container.querySelector(".e-job-row-property")).toHaveClass("min-w-0");
    expect(container.querySelector("[data-density]")).toBeNull();
  });
  it.each([
    ["compact", "p-2.5"], ["default", "p-3.5"], ["comfortable", "p-5"],
  ] as const)("renders %s board cards locally", (density, padding) => {
    const { container } = render(<EBoardCard {...props} density={density} />);
    expect(screen.getByRole("link")).toHaveClass(padding);
    expect(container.querySelector("[data-density]")).toBeNull();
  });
});
