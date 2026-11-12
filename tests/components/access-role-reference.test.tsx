import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AccessRoleReference } from "@/components/v2/admin/settings/access/access-role-reference";
import { PERMISSIONS } from "@/lib/rbac/permissions";

afterEach(cleanup);

describe("Access and permissions: What each role can do by default", () => {
  it("starts collapsed and builds the read-only reference only once opened", () => {
    const { container } = render(<AccessRoleReference />);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(screen.getByText("What each role can do by default")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();

    details.open = true;
    fireEvent(details, new Event("toggle"));

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(Object.keys(PERMISSIONS).length + 1);
    expect(within(table).getByRole("rowheader", { name: "jobs:delete" })).toBeTruthy();
    expect(within(table).getAllByText("Needs Full + PIN").length).toBe(3);
    expect(screen.getByRole("heading", { name: "Only administrators" })).toBeTruthy();
    // Read-only: nothing to change here.
    expect(within(details).queryAllByRole("button")).toHaveLength(0);
    expect(within(details).queryAllByRole("checkbox")).toHaveLength(0);
  });
});
