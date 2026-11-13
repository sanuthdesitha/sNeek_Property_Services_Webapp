import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

const m = vi.hoisted(() => ({ position: vi.fn() }));
vi.mock("@/lib/geo/get-position", async () => {
  const actual = await vi.importActual<typeof import("@/lib/geo/get-position")>("@/lib/geo/get-position");
  return { ...actual, getAccuratePosition: m.position };
});
import { GpsError } from "@/lib/geo/get-position";
import { useLocationGate, type GateResult } from "@/components/v2/location/location-gate";

let result: GateResult | undefined;
function Harness() {
  const gate = useLocationGate("CLEANER");
  return (
    <div>
      <button type="button" onClick={async () => { result = await gate.ensureReady(); }}>Start</button>
      {gate.element}
    </div>
  );
}

const fetcher = vi.fn();
beforeEach(() => {
  result = undefined;
  fetcher.mockReset().mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? Response.json({ ok: true })
      : Response.json({ acknowledged: true, version: 1, impersonating: false }));
  vi.stubGlobal("fetch", fetcher);
  m.position.mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("live-location start gate", () => {
  it("returns the fix when the phone has one", async () => {
    m.position.mockResolvedValue({ lat: 1, lng: 2, accuracy: 5, heading: null, speed: null, timestamp: 0 });
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(result).toEqual({ lat: 1, lng: 2, accuracy: 5 }));
  });

  it("refuses when location permission is denied (enforced tracking)", async () => {
    m.position.mockRejectedValue(new GpsError("PERMISSION_DENIED", "Location access is blocked."));
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("Turn on location to start")).toBeVisible();
    await waitFor(() => expect(result).toBeNull());
    expect(screen.queryByText("Start without a location fix?")).not.toBeInTheDocument();
  });

  it("refuses until the notice is accepted, and records the acceptance", async () => {
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? Response.json({ ok: true }) : Response.json({ acknowledged: false, version: 1, impersonating: false }));
    m.position.mockResolvedValue({ lat: 1, lng: 2, accuracy: 5, heading: null, speed: null, timestamp: 0 });
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await userEvent.click(await screen.findByRole("button", { name: "Not now" }));
    await waitFor(() => expect(result).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await userEvent.click(await screen.findByRole("button", { name: "I understand" }));
    await waitFor(() => expect(result).toEqual({ lat: 1, lng: 2, accuracy: 5 }));
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST" && JSON.parse(String(init.body)).version === 1)).toBe(true);
  });

  it("allows a start without a fix (permission granted) with a chosen reason", async () => {
    m.position.mockRejectedValue(new GpsError("TIMEOUT", "Could not get a GPS fix in time."));
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("Start without a location fix?")).toBeVisible();
    await userEvent.click(screen.getByLabelText("Indoors or in a basement"));
    await userEvent.click(screen.getByRole("button", { name: "Start without a fix" }));
    await waitFor(() => expect(result).toEqual({ noFix: { reason: "Indoors or in a basement", error: "TIMEOUT" } }));
  });

  it("requires a typed reason for Other, and can be cancelled", async () => {
    m.position.mockRejectedValue(new GpsError("UNAVAILABLE", "Location is currently unavailable on this device."));
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await userEvent.click(await screen.findByLabelText("Other"));
    await userEvent.click(screen.getByRole("button", { name: "Start without a fix" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 3 characters");
    await userEvent.type(screen.getByLabelText("Reason"), "Phone GPS broken");
    await userEvent.click(screen.getByRole("button", { name: "Start without a fix" }));
    await waitFor(() => expect(result).toEqual({ noFix: { reason: "Phone GPS broken", error: "UNAVAILABLE" } }));
    result = undefined;
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await act(async () => { await userEvent.click(await screen.findByRole("button", { name: "Try again later" })); });
    await waitFor(() => expect(result).toBeNull());
  });
});
