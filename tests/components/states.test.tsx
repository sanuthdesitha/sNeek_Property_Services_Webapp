import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";

describe("EmptyState", () => {
  it("renders title, body, and CTA", () => {
    render(<EmptyState title="No jobs" body="Create one to start." action={<button>Create</button>} />);
    expect(screen.getByText("No jobs")).toBeInTheDocument();
    expect(screen.getByText("Create one to start.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });
});

describe("LoadingState", () => {
  it("renders skeleton bars", () => {
    const { container } = render(<LoadingState />);
    expect(container.querySelector(".skeleton")).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("renders error message and retry button when onRetry provided", () => {
    const onRetry = () => {};
    render(<ErrorState message="Server unreachable" onRetry={onRetry} />);
    expect(screen.getByText("Server unreachable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
