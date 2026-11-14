/**
 * Live ops map pins: the DOM pills and the map's OverlayView wiring (with a
 * fake google.maps, since tests have no key). Tapping a pin must keep the old
 * marker behaviour: select the person and open their info window.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/maps/loader", () => ({ ensureGoogleMaps: () => Promise.resolve() }));

import { EstateOpsMap } from "@/components/v2/admin/ops/estate-ops-map";
import { OpsMapLegend, PersonPinButton, PersonPinStack, PropertyPinButton } from "@/components/v2/admin/ops/ops-map-pin-views";
import { buildPropertyPins, cleanerPin, driverPin, type PersonPin } from "@/components/v2/admin/ops/ops-map-pins";
import type { LivePing } from "@/lib/ops/live-feed-types";
import type { LiveDriverRow, LiveJobRow } from "@/lib/ops/live-board-types";

const NOW = Date.now();
const aiko: LivePing = { userId: "u1", user: { name: "Aiko Tanaka" }, lat: -33.88, lng: 151.18, accuracy: 10, timestamp: new Date(NOW).toISOString(), positionSource: "gps", liveStatus: "EN_ROUTE" };
const sam: LivePing = { ...aiko, userId: "u2", user: { name: "Sam O." }, liveStatus: "OFF_SITE", lat: -33.88001, lng: 151.18001 };
const tom: LiveDriverRow = { routeId: "r1", userId: "d1", name: "Tom Smith", phone: null, stopsDone: 2, stopsTotal: 6, lat: -33.95, lng: 151.25, accuracy: 300, lastPingAt: new Date(NOW).toISOString() };
const lateRow = {
  jobId: "j1", jobNumber: "1", propertyName: "Glebe House", suburb: null, status: "EN_ROUTE", state: "late", startTime: "10:30", dueTime: null,
  sameDayCheckinTime: null, cleaners: [{ id: "u1", name: "Aiko Tanaka", phone: null }], minutes: 18, etaClock: null, distanceMeters: null,
  elapsedMinutes: null, allocatedMinutes: null, progress: null, openTimeLogId: null, field: { address: null, safety: null, checkInDistanceMeters: null, gpsCheckInAt: null },
} as LiveJobRow;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("pin pills", () => {
  it("reads as name and short status, with the whole state in its accessible name", async () => {
    const onActivate = vi.fn();
    const pin = cleanerPin(aiko, [lateRow], "u1", NOW)!;
    render(<PersonPinButton pin={pin} onActivate={onActivate} />);
    const button = screen.getByRole("button", { name: /Aiko Tanaka, cleaner: 18 min late/ });
    expect(button).toHaveTextContent("AT");
    expect(button).toHaveTextContent("Aiko T. · 18 min late");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button.className).toContain("ring-2");
    expect(button.className).toContain("border-[hsl(var(--e-danger))]");
    button.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it("draws approximate as a dashed pill and the job-address fallback as a hollow badge", () => {
    const approx = driverPin(tom, null, NOW)!;
    const fallback = cleanerPin({ ...aiko, positionSource: "property" }, [], null, NOW)!;
    render(<><PersonPinButton pin={approx} onActivate={vi.fn()} /><PersonPinButton pin={fallback} onActivate={vi.fn()} /></>);
    const driverButton = screen.getByRole("button", { name: /laundry driver/ });
    expect(driverButton.className).toContain("border-dashed");
    expect(driverButton).toHaveTextContent("Driver Tom S. · approx.");
    const fallbackButton = screen.getByRole("button", { name: /shown at the job address/ });
    expect(fallbackButton).toHaveTextContent("no GPS");
    expect(within(fallbackButton).getByText("AT").className).toContain("bg-[hsl(var(--e-surface))]");
  });

  it("a big group shows +N, expands on tap, and keeps the selected person visible", () => {
    const pins: PersonPin[] = ["a", "b", "c", "d"].map((key, index) => ({ ...cleanerPin({ ...aiko, userId: key, user: { name: `Person ${key}` } }, [], "d", NOW)!, rank: index }));
    const group = { id: "a|b|c|d", lat: 0, lng: 0, members: pins };
    const onToggle = vi.fn();
    const { rerender } = render(<PersonPinStack group={group} expanded={false} selectedKey="d" onActivate={vi.fn()} onToggle={onToggle} />);
    expect(screen.getAllByRole("button", { name: /cleaner/ }).map((b) => b.textContent)).toEqual(["PAPerson A. · on the way", "PDPerson D. · on the way"]);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more people here" }));
    expect(onToggle).toHaveBeenCalledWith("a|b|c|d");
    rerender(<PersonPinStack group={group} expanded selectedKey="d" onActivate={vi.fn()} onToggle={onToggle} />);
    expect(screen.getAllByRole("button", { name: /cleaner/ })).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Show fewer people here" })).toHaveAttribute("aria-expanded", "true");
  });

  it("properties are a house glyph, named only when asked, never an initials badge", () => {
    const [pin] = buildPropertyPins([{ name: "Quiet Flat", suburb: "Newtown", lat: 0, lng: 0 }], []);
    const { rerender } = render(<PropertyPinButton pin={pin} showLabel={false} onActivate={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Property: Quiet Flat, Newtown. No job on today's board." });
    expect(button).not.toHaveTextContent("Quiet Flat");
    rerender(<PropertyPinButton pin={pin} showLabel onActivate={vi.fn()} />);
    expect(button).toHaveTextContent("Quiet Flat");
  });

  it("the key explains every pin style in words", () => {
    render(<OpsMapLegend />);
    const legend = screen.getByRole("group", { name: "Map key" });
    for (const text of ["On site", "On the way", "Late", "Laundry driver", "Aging (< 10 min)", "Stale (10 min +)", "No GPS · shown at job address", "Selected"]) {
      expect(within(legend).getByText(text)).toBeInTheDocument();
    }
    expect(within(legend).getByText(/Approximate/)).toBeInTheDocument();
    expect(within(legend).getByText(/Property/)).toBeInTheDocument();
  });
});

// ── The map with a fake google.maps ────────────────────────────────────────

function installFakeGoogle() {
  const infoWindows: Array<{ content: string; open: ReturnType<typeof vi.fn> }> = [];
  class FakeMap {
    constructor(public el: HTMLElement) {}
    getZoom() { return 15; }
    fitBounds = vi.fn();
    panTo = vi.fn();
    setZoom = vi.fn();
  }
  class FakeInfoWindow {
    content = "";
    open = vi.fn();
    close = vi.fn();
    constructor() { infoWindows.push(this); }
    setContent(html: string) { this.content = html; }
    setPosition() {}
  }
  class FakeOverlayView {
    pane = document.createElement("div");
    static preventMapHitsAndGesturesFrom = vi.fn();
    getPanes() { return { overlayMouseTarget: this.pane }; }
    getProjection() { return { fromLatLngToDivPixel: (ll: { lat: number; lng: number }) => ({ x: ll.lng, y: ll.lat }) }; }
    setMap(map: FakeMap | null) {
      const self = this as unknown as { onAdd?: () => void; draw?: () => void; onRemove?: () => void };
      if (map) { map.el.appendChild(this.pane); self.onAdd?.(); self.draw?.(); } else self.onRemove?.();
    }
  }
  class Noop { constructor(..._args: unknown[]) {} setOptions() {} setMap() {} extend() {} }
  vi.stubGlobal("google", {
    maps: {
      Map: FakeMap, InfoWindow: FakeInfoWindow, OverlayView: FakeOverlayView, Circle: Noop, Polyline: Noop, LatLngBounds: Noop, Size: Noop,
      LatLng: class { constructor(public lat: number, public lng: number) {} },
    },
  });
  return { infoWindows };
}

describe("EstateOpsMap pins", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

  it("draws pills in the overlay; tapping one selects the person and opens their info", async () => {
    const { infoWindows } = installFakeGoogle();
    const onSelect = vi.fn();
    render(
      <EstateOpsMap
        properties={[{ name: "Glebe House", suburb: null, lat: -33.9, lng: 151.1 }]}
        pings={[aiko, sam]}
        drivers={[tom]}
        jobs={[lateRow]}
        layers={{ cleaners: true, drivers: true, properties: true }}
        selectedUserId={null}
        onSelect={onSelect}
      />,
    );
    const aikoPin = await screen.findByRole("button", { name: /Aiko Tanaka, cleaner: 18 min late/ });
    expect(aikoPin.closest("[data-ops-pins]")).not.toBeNull();
    // Aiko and Sam are at the same spot: one stack, Aiko (late) on the point.
    const stack = screen.getByRole("group", { name: "2 people at about the same place" });
    expect(within(stack).getAllByRole("button").map((b) => b.getAttribute("aria-label")?.split(",")[0])).toEqual(["Aiko Tanaka", "Sam O."]);
    expect(screen.getByRole("button", { name: /Tom Smith, laundry driver/ })).toBeInTheDocument();
    // Today's board names Glebe House, so the property is labelled even at zoom 15.
    expect(screen.getByRole("button", { name: /Property: Glebe House\. Today: cleaner late/ })).toHaveTextContent("Glebe House · cleaner late");

    await act(async () => { fireEvent.click(aikoPin); });
    expect(onSelect).toHaveBeenCalledWith("u1");
    expect(infoWindows[0].open).toHaveBeenCalled();
    expect(infoWindows[0].content).toContain("Aiko Tanaka");

    fireEvent.click(screen.getByRole("button", { name: /Tom Smith/ }));
    expect(onSelect).toHaveBeenLastCalledWith("d1");
    expect(infoWindows[0].content).toContain("Laundry route");
    expect(screen.getByRole("group", { name: "Map key" })).toBeInTheDocument();
  });

  it("layer toggles remove pins", async () => {
    installFakeGoogle();
    render(<EstateOpsMap properties={[]} pings={[aiko]} drivers={[tom]} layers={{ cleaners: false, drivers: true, properties: false }} selectedUserId={null} onSelect={vi.fn()} />);
    await screen.findByRole("button", { name: /Tom Smith/ });
    expect(screen.queryByRole("button", { name: /Aiko/ })).toBeNull();
  });
});
