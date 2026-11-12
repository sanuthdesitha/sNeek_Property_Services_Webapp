import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { EField as SettingsField, EInput as SettingsInput } from "@/components/v2/admin/settings/estate-form";
import { EField as CleanerField, EInput as CleanerInput } from "@/components/v2/cleaner/fields";

describe("EField ties its label to a single control", () => {
  it("label click focuses the input and getByLabelText finds it", async () => {
    render(
      <EField label="Job number" hint="As printed on the invoice.">
        <EInput placeholder="J-1" />
      </EField>,
    );
    const input = screen.getByLabelText("Job number");
    expect(input).toBe(screen.getByPlaceholderText("J-1"));
    await userEvent.click(screen.getByText("Job number"));
    expect(input).toHaveFocus();
    expect(input).toHaveAccessibleDescription("As printed on the invoice.");
  });

  it("works for select, textarea and native controls, keeping an existing id", () => {
    render(
      <>
        <EField label="Method"><ESelect><option>Push</option></ESelect></EField>
        <EField label="Note"><ETextarea /></EField>
        <EField label="Native"><input id="kept-id" aria-describedby="other" /></EField>
      </>,
    );
    expect(screen.getByLabelText("Method").tagName).toBe("SELECT");
    expect(screen.getByLabelText("Note").tagName).toBe("TEXTAREA");
    const native = screen.getByLabelText("Native");
    expect(native.id).toBe("kept-id");
    expect(native.getAttribute("aria-describedby")).toBe("other");
  });

  it("a non-control child still renders as before, with no association", () => {
    render(
      <EField label="Address" hint="Pick one">
        <div data-testid="composite"><button type="button">Choose</button></div>
      </EField>,
    );
    expect(screen.getByTestId("composite")).toBeInTheDocument();
    expect(screen.getByText("Address").closest("label")).not.toHaveAttribute("for");
    expect(screen.queryByLabelText("Address")).toBeNull();
  });

  it("several children render unchanged", () => {
    render(
      <EField label="Range">
        <EInput placeholder="from" />
        <EInput placeholder="to" />
      </EField>,
    );
    expect(screen.getByPlaceholderText("from")).not.toHaveAttribute("id");
    expect(screen.queryByLabelText("Range")).toBeNull();
  });

  it("settings and cleaner field wrappers associate the same way", async () => {
    render(
      <>
        <SettingsField label="Business name"><SettingsInput /></SettingsField>
        <SettingsField label="Explicit" htmlFor="explicit-id"><SettingsInput /></SettingsField>
        <CleanerField label="Bag count"><CleanerInput /></CleanerField>
      </>,
    );
    expect(screen.getByLabelText("Business name").tagName).toBe("INPUT");
    expect(screen.getByLabelText("Explicit").id).toBe("explicit-id");
    await userEvent.click(screen.getByText("Bag count"));
    expect(screen.getByLabelText("Bag count")).toHaveFocus();
  });
});
