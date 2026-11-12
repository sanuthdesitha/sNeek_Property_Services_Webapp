import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AssignCleanersModal } from "@/components/v2/admin/jobs/assign-cleaners-modal";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it("after replacing the primary cleaner, offers the client note unsent and sends the edited text only on request", async () => {
  const fetcher = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (url.includes("/assign")
      ? { ok: true, reassignPreview: { clientId: "c1", jobId: "j1", cleanerName: "Aiko", recipients: ["host@x"], subject: "Your cleaner changed", html: "<p>Hi</p>" } }
      : { recipients: ["host@x"] }),
  }));
  vi.stubGlobal("fetch", fetcher);
  render(<AssignCleanersModal open onClose={vi.fn()} jobId="j1" cleaners={[{ id: "u1", name: "Jane", email: "j@x" }, { id: "u2", name: "Aiko", email: "a@x" }]}
    initialAssignedIds={["u1"]} initialPrimaryId="u1" onAssigned={vi.fn()} />);
  fireEvent.click(screen.getByText("Jane"));
  fireEvent.click(screen.getByText("Aiko"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Save assignment/ })); });
  expect(screen.getByRole("heading", { name: "Tell the client their cleaner changed?" })).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByDisplayValue("Your cleaner changed"), { target: { value: "New cleaner tomorrow" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send to client" })); });
  const [url, init] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
  expect(url).toBe("/api/admin/clients/c1/communications/send");
  expect(JSON.parse(String(init.body))).toMatchObject({ stage: "CLEANER_REASSIGNED", jobId: "j1", override: { subject: "New cleaner tomorrow", html: "<p>Hi</p>" } });
});
