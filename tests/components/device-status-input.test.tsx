import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DeviceStatusInput } from "@/components/forms/device-status-input";
const field = { id: "minut", label: "Minut charged?" };
it("never rewrites historical answers on mount and requires an explicit exception and reason", () => {
 const change = vi.fn();
 function Fixture() { const [value, set] = useState<unknown>(false); return <DeviceStatusInput field={field} value={value} onChange={next => { change(next); set(next); }} />; }
 render(<Fixture />);
 expect(change).not.toHaveBeenCalled();
 expect(screen.getByText(/Previously recorded: No/)).toBeVisible();
 fireEvent.change(screen.getByRole("combobox"), { target: { value: "NOT_CHECKED" } });
 fireEvent.change(screen.getByRole("textbox"), { target: { value: "Not checked today" } });
 expect(change).toHaveBeenLastCalledWith({ deviceStatus: "NOT_CHECKED", reason: "Not checked today" });
 expect(screen.getByText(/does not confirm/)).toBeVisible();
 fireEvent.change(screen.getByRole("combobox"), { target: { value: "CONFIRMED" } });
 expect(change).toHaveBeenLastCalledWith(true);
});
