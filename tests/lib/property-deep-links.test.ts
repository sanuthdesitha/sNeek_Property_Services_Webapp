import { describe, expect, it } from "vitest";
import { PROPERTY_TABS, resolvePropertyTab } from "@/lib/properties/detail-tabs";
import { copyPropertyHref, newJobHref } from "@/lib/properties/links";
import {
  DEFAULT_PORTFOLIO_VIEW,
  nextPortfolioView,
  portfolioListQuery,
  portfolioSearch,
  readPortfolioView,
} from "@/components/v2/admin/properties/list/portfolio-view";

describe("property page tabs", () => {
  it("keeps old ?tab= links: profile opens Overview, inventory opens Stock", () => {
    expect(resolvePropertyTab("profile")).toBe("overview");
    expect(resolvePropertyTab("inventory")).toBe("stock");
    for (const old of ["jobs", "checklist", "access", "billing"]) expect(resolvePropertyTab(old)).toBe(old);
  });

  it("opens Overview for a missing or unknown tab and accepts every drawn tab", () => {
    expect(resolvePropertyTab(null)).toBe("overview");
    expect(resolvePropertyTab("nonsense")).toBe("overview");
    for (const tab of PROPERTY_TABS) expect(resolvePropertyTab(tab)).toBe(tab);
  });

  it("New job here opens the New job form pre-filled with the property", () => {
    expect(newJobHref("abc")).toBe("/v2/admin/jobs/new?propertyId=abc");
    expect(copyPropertyHref("abc")).toBe("/v2/admin/properties/new?copyFrom=abc");
  });
});

describe("properties list URL state", () => {
  it("keeps the old ?includeOneOff=1 link and round-trips the view", () => {
    const view = readPortfolioView("?includeOneOff=1&chip=sync-error&q=glebe&view=cards&sort=qa&dir=desc&page=2&open=p_1");
    expect(view).toMatchObject({ includeOneOff: true, chip: "sync-error", q: "glebe", mode: "cards", sort: "qa", dir: "desc", page: 2, open: "p_1" });
    expect(readPortfolioView(portfolioSearch(view))).toEqual(view);
  });

  it("drops unknown values from a link rather than passing them on", () => {
    expect(readPortfolioView("?chip=all&sort=price&view=grid&open=../x")).toEqual(DEFAULT_PORTFOLIO_VIEW);
  });

  it("any change to what is listed starts again at page 1, opening a panel does not", () => {
    const onPage3 = { ...DEFAULT_PORTFOLIO_VIEW, page: 3 };
    expect(nextPortfolioView(onPage3, { chip: "key-lost" }).page).toBe(1);
    expect(nextPortfolioView(onPage3, { open: "p" }).page).toBe(3);
  });

  it("asks the server for the list shape with paging", () => {
    const query = new URLSearchParams(portfolioListQuery({ ...DEFAULT_PORTFOLIO_VIEW, suburb: "Manly" }, 25));
    expect(query.get("shape")).toBe("list");
    expect(query.get("pageSize")).toBe("25");
    expect(query.get("suburb")).toBe("Manly");
  });
});
