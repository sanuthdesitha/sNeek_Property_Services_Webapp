import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Next's useRouter throws "invariant expected app router to be mounted"
// outside of an <AppRouterProvider>. Stub the hook for the smoke render.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/admin/forms/test/edit",
  useSearchParams: () => new URLSearchParams(),
}));

// Imported after the mock so FormBuilder picks up the stubbed module.
// eslint-disable-next-line import/first
import { FormBuilder } from "@/components/forms/form-builder";

describe("FormBuilder", () => {
  it("renders the template name input and the Add section button", () => {
    render(
      <FormBuilder
        templateId="test"
        initialName="Test Form"
        initialKind="CUSTOM"
        initialVersion={1}
        initialSchema={{ sections: [] }}
        initialIsActive={false}
        initialArchived={false}
      />,
    );
    expect(screen.getByDisplayValue("Test Form")).toBeInTheDocument();
    expect(screen.getByText(/Add section/i)).toBeInTheDocument();
  });

  it("shows kind, version, section count and field count in the subtitle", () => {
    render(
      <FormBuilder
        templateId="test"
        initialName="Test"
        initialKind="DEEP_CLEAN"
        initialVersion={3}
        initialSchema={{
          sections: [
            {
              id: "s1",
              title: "Section 1",
              fields: [{ id: "f1", type: "text", label: "Field 1" }],
            },
          ],
        }}
        initialIsActive={false}
        initialArchived={false}
      />,
    );
    expect(screen.getByText(/DEEP_CLEAN/)).toBeInTheDocument();
    expect(screen.getByText(/v3/)).toBeInTheDocument();
    expect(screen.getByText(/1 sections/)).toBeInTheDocument();
    // Both the header subtitle and the per-section badge include "1 fields";
    // assert via getAllByText so we accept either occurrence.
    expect(screen.getAllByText(/1 fields/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders the published status pill when the template is active", () => {
    render(
      <FormBuilder
        templateId="test"
        initialName="Live"
        initialKind="AIRBNB_TURNOVER"
        initialVersion={1}
        initialSchema={{ sections: [] }}
        initialIsActive={true}
        initialArchived={false}
      />,
    );
    expect(screen.getByText(/Published/i)).toBeInTheDocument();
    expect(screen.getByText(/Archive/i)).toBeInTheDocument();
  });

  it("renders the archived status pill when archivedAt is set", () => {
    render(
      <FormBuilder
        templateId="test"
        initialName="Old"
        initialKind="CUSTOM"
        initialVersion={1}
        initialSchema={{ sections: [] }}
        initialIsActive={false}
        initialArchived={true}
      />,
    );
    expect(screen.getByText(/Archived/i)).toBeInTheDocument();
  });
});
