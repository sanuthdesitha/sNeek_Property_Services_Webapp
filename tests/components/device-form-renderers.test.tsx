import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FormRenderer } from "@/components/v2/cleaner/form-renderer";
import { FieldRenderer } from "@/components/forms/field-renderer";
vi.mock("@/components/v2/cleaner/media-capture", () => ({ MediaCapture: () => null }));
afterEach(cleanup);
const field = { id: "minut", type: "checkbox" as const, label: "Minut charged?", required: true };
it("shows a saved not-checked exception in the actual Estate renderer; select-all cannot overwrite it", () => {
 const answer = { deviceStatus: "NOT_CHECKED", reason: "Did not check today" };
 const onAnswer = vi.fn();
 render(<FormRenderer schema={{ sections: [{ id: "room", title: "Room", fields: [field, { id: "a", type: "checkbox", label: "Surface cleaned" }, { id: "b", type: "checkbox", label: "Floor cleaned" }] }] }} answers={{ minut: answer }} uploads={{}} property={{}} inventoryStock={[]} onAnswer={onAnswer} onUpload={vi.fn()} />);
 expect(screen.getByRole("combobox")).toHaveValue("NOT_CHECKED");
 expect(screen.getByRole("textbox")).toHaveValue(answer.reason);
 fireEvent.click(screen.getByRole("button", { name: "Select all", exact: true }));
 expect(onAnswer.mock.calls).toEqual([["a", true], ["b", true]]);
});
it("uses the same explicit exception control in the classic renderer without rewriting saved booleans", () => {
 const onAnswer = vi.fn();
 render(<FieldRenderer field={field} answers={{ minut: true }} onAnswer={onAnswer} />);
 expect(screen.getByRole("combobox")).toHaveValue("CONFIRMED");
 expect(onAnswer).not.toHaveBeenCalled();
 fireEvent.change(screen.getByRole("combobox"), { target: { value: "NOT_APPLICABLE" } });
 expect(onAnswer).toHaveBeenCalledWith("minut", { deviceStatus: "NOT_APPLICABLE", reason: "" });
});
