import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

describe("FormField", () => {
  it("renders label, hint, and connects label-for to control id", () => {
    render(
      <FormField id="email" label="Email" hint="We never share it.">
        <Input id="email" />
      </FormField>
    );
    const label = screen.getByText("Email");
    expect(label).toHaveAttribute("for", "email");
    expect(screen.getByText("We never share it.")).toBeInTheDocument();
  });

  it("renders error message and applies role=alert", () => {
    render(
      <FormField id="email" label="Email" error="Required">
        <Input id="email" />
      </FormField>
    );
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.getByText("Required")).toHaveAttribute("role", "alert");
  });

  it("hides hint when error is present", () => {
    render(
      <FormField id="email" label="Email" hint="Hint text" error="Required">
        <Input id="email" />
      </FormField>
    );
    expect(screen.queryByText("Hint text")).not.toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
  });
});
