import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VaTeamManager } from "@/components/v2/client/va-team-manager";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount() {
  render(<VaTeamManager properties={[{ id: "one", name: "Property One" }, { id: "two", name: "Property Two" }]}
    initialTeams={[{ id: "team", name: "Assistants", isActive: true, permissions: {}, propertyIds: ["one"], members: [] }]} />);
}

describe("VA team edits", () => {
  it("locks all permission and scope controls until a save settles", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Bookings/ }));
    expect(screen.getByRole("checkbox", { name: /Maintenance/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Property Two" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Maintenance/ }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    finish(Response.json({ permissions: { bookings: true } }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Maintenance/ })).not.toBeDisabled());
  });

  it("does not turn removal of the last property into unrestricted access", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: "Property One" }));
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByText("Select at least one property, or explicitly enable All properties.")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Property One" })).toHaveAttribute("aria-checked", "true");
  });
});
