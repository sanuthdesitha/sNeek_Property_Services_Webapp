import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsNavigation } from "@/components/v2/admin/settings/settings-navigation";
import {
  availableSettings,
  settingsHref,
} from "@/components/v2/admin/settings/settings-catalog";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("groups rates under Money and shows only that category's section links", () => {
  render(
    <SettingsNavigation
      sections={availableSettings(true)}
      activeTab="holiday-rates"
    />,
  );
  const nav = screen.getByRole("navigation", { name: "Money settings" });
  expect(
    within(nav).getByRole("link", { name: "Public holiday rates" }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    within(nav).getByRole("link", { name: "Cleaner rates" }),
  ).toHaveAttribute("href", settingsHref("rates"));
  expect(
    within(nav).queryByRole("link", { name: "Laundry & locations" }),
  ).toBeNull();
  expect(screen.queryByRole("heading", { name: "Browse settings" })).toBeNull();
});

it("searches descriptions across categories and clears without remounting the active form", () => {
  render(
    <>
      <SettingsNavigation sections={availableSettings(true)} activeTab="bank" />
      <input aria-label="Unsaved bank draft" defaultValue="Keep this draft" />
    </>,
  );
  const draft = screen.getByLabelText("Unsaved bank draft");
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "holiday multipliers" },
  });
  const results = screen.getByRole("region", {
    name: "Settings search results",
  });
  expect(within(results).getAllByRole("link")).toHaveLength(1);
  expect(within(results).getByRole("link")).toHaveAttribute(
    "href",
    settingsHref("holiday-rates"),
  );
  expect(screen.getByRole("status")).toHaveTextContent("1 matching setting");
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByLabelText("Unsaved bank draft")).toBe(draft);
  expect(draft).toHaveValue("Keep this draft");
});

it("announces no matches and supports Escape to restore navigation", () => {
  render(
    <SettingsNavigation
      sections={availableSettings(true)}
      activeTab="overview"
    />,
  );
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "not-a-setting" },
  });
  expect(screen.getByRole("status")).toHaveTextContent("No settings found");
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
  expect(
    screen.getByRole("heading", { name: "Browse settings" }),
  ).toBeVisible();
});

it("omits administrator-only destinations from cards, search and mobile navigation", () => {
  render(
    <SettingsNavigation
      sections={availableSettings(false)}
      activeTab="overview"
    />,
  );
  expect(
    screen.queryByRole("option", { name: "Public holiday rates" }),
  ).toBeNull();
  expect(
    screen.getByRole("option", { name: "Property form" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "holiday" },
  });
  expect(screen.getByRole("status")).toHaveTextContent("No settings found");
});

it("navigates from the grouped mobile selector using the existing tab URLs", () => {
  render(
    <SettingsNavigation
      sections={availableSettings(true)}
      activeTab="overview"
    />,
  );
  fireEvent.change(screen.getByLabelText("Go to setting"), {
    target: { value: "laundry" },
  });
  expect(push).toHaveBeenCalledWith("/v2/admin/settings?tab=laundry");
});

it("encodes job context only for public holiday rates", () => {
  const id = "job & other=1/#";
  const url = new URL(settingsHref("holiday-rates", id), "http://localhost");
  expect(url.searchParams.get("jobId")).toBe(id);
  expect(url.searchParams.get("other")).toBeNull();
  expect(settingsHref("bank", id)).toBe("/v2/admin/settings?tab=bank");
});
