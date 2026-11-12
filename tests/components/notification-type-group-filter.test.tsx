import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TypeList } from "@/components/v2/admin/notifications/type-list";
import { NOTIFICATION_CATALOG } from "@/lib/notifications/catalog";
import { CATALOG_GROUPS } from "@/lib/notifications/catalog-types";
import type { CatalogTypeView } from "@/lib/notifications/catalog-view-types";

/**
 * Parity (2026-11-12): the old Types tab filtered by notification group
 * (business area). The wording workspace's type list keeps that filter next
 * to its search, status chips and audience grouping.
 */
const TYPES: CatalogTypeView[] = NOTIFICATION_CATALOG.map((entry) => ({
  ...entry,
  resolvedSwitches: [],
  respectsPreferencesNow: null,
  disabledTransports: [],
  externalPaths: {},
  templateHref: null,
}));

function renderList() {
  return render(
    <TypeList
      types={TYPES}
      summaries={new Map()}
      controlsUpdatedAt={null}
      selectedKey={null}
      onSelect={vi.fn()}
      canSwitch={false}
      switching={false}
      onSwitch={vi.fn()}
      switchNote={null}
    />,
  );
}

function listedNames(): string[] {
  const list = screen.getByRole("region", { name: "Notification types" });
  return within(list)
    .queryAllByRole("listitem")
    .map((item) => within(item).getAllByRole("button")[0].textContent ?? "");
}

afterEach(cleanup);

describe("notification types: group filter", () => {
  it("offers every catalog group with its count and filters the list to one group", () => {
    renderList();
    expect(listedNames()).toHaveLength(TYPES.length);
    fireEvent.click(screen.getByRole("button", { name: /Group: All/ }));
    const panel = screen.getByRole("group", { name: "Group filter" });
    const radios = within(panel).getAllByRole("radio");
    expect(radios).toHaveLength(CATALOG_GROUPS.length + 1);
    expect(within(panel).getByText("All groups").parentElement?.textContent).toContain(String(TYPES.length));

    const money = TYPES.filter((type) => type.group === "Money");
    expect(money.length).toBeGreaterThan(0);
    const moneyOption = within(panel).getByRole("radio", { name: /Money/ });
    expect(moneyOption.closest("label")?.textContent).toContain(String(money.length));
    fireEvent.click(moneyOption);

    expect(screen.getByRole("button", { name: /Group: Money/ })).toBeTruthy();
    expect(listedNames()).toHaveLength(money.length);
    for (const name of listedNames()) expect(money.some((type) => name.startsWith(type.name))).toBe(true);
  });

  it("combines with the search and returns to every type on All groups", () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /Group: All/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Jobs/ }));
    fireEvent.change(screen.getByLabelText("Search notifications"), { target: { value: "zzzz-no-such-type" } });
    expect(screen.getByText("No notification matches this search or filter.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search notifications"), { target: { value: "" } });
    expect(listedNames()).toHaveLength(TYPES.filter((type) => type.group === "Jobs").length);
    fireEvent.click(screen.getByRole("radio", { name: /All groups/ }));
    expect(listedNames()).toHaveLength(TYPES.length);
  });
});
