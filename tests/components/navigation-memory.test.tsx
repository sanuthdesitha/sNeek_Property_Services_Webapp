import { act, renderHook, render, fireEvent, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useRestorableState } from "@/hooks/use-restorable-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
vi.mock("next/navigation", () => ({ usePathname: () => window.location.pathname }));
beforeEach(() => history.replaceState({}, "", "/v2/admin/properties/one"));
it("writes a choice before immediate unmount and restores it on return", () => {
  const first = renderHook(() => useRestorableState("step", "profile"));
  act(() => first.result.current[1]("jobs")); first.unmount();
  const second = renderHook(() => useRestorableState("step", "profile"));
  expect(second.result.current[0]).toBe("jobs");
  history.replaceState({}, "", "/v2/admin/properties/two"); second.rerender();
  expect(second.result.current[0]).toBe("profile");
});
function Sample() {
  return <Tabs defaultValue="profile"><TabsList><TabsTrigger value="profile">Profile</TabsTrigger><TabsTrigger value="jobs">Jobs</TabsTrigger></TabsList><TabsContent value="profile">Property details</TabsContent><TabsContent value="jobs">Work history</TabsContent></Tabs>;
}
it("shared tabs return to the last section without persisting form fields", () => {
  const first = render(<Sample />);
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Jobs" }), { button: 0, ctrlKey: false });
  expect(screen.getByText("Work history")).toBeVisible(); first.unmount();
  render(<Sample />);
  expect(screen.getByRole("tab", { name: "Jobs" })).toHaveAttribute("aria-selected", "true");
});
