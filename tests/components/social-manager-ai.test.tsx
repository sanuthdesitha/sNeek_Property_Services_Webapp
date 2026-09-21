import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SocialManager } from "@/components/v2/admin/marketing/social-manager";
afterEach(() => vi.unstubAllGlobals());
function open() {
  render(<SocialManager initialPosts={[]} onToast={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "New draft" }));
  fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "Airbnb cleaning in Sydney" } });
}
it("generates only on request and requires explicitly applying then saving the draft", async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ caption: "A clean welcome.", hashtags: ["#Sydney"], suggestedHook: "Welcome" }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ post: { id: "1", caption: "A clean welcome.\n\n#Sydney", channel: "INSTAGRAM", status: "DRAFT", createdAt: new Date().toISOString() } }) });
  vi.stubGlobal("fetch", fetch); open();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Caption"), { target: { value: "My own caption" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
  await screen.findByText("Generated suggestion");
  expect(screen.getByLabelText("Caption")).toHaveValue("My own caption");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ platform: "INSTAGRAM", topic: "Airbnb cleaning in Sydney", tone: "friendly" });
  fireEvent.click(screen.getByRole("button", { name: "Use generated caption" }));
  expect(screen.getByLabelText("Caption")).toHaveValue("A clean welcome.\n\n#Sydney");
  fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(fetch.mock.calls[1][0]).toBe("/api/admin/marketing/social");
  expect(JSON.parse(fetch.mock.calls[1][1].body).caption).toBe("A clean welcome.\n\n#Sydney");
});
it.each([false, true])("preserves caption when generation fails or returns invalid output (%s)", async malformed => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: malformed, json: async () => malformed ? { caption: 123 } : { error: "Model unavailable" } }));
  open(); fireEvent.change(screen.getByLabelText("Caption"), { target: { value: "Keep me" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Caption")).toHaveValue("Keep me");
  expect(screen.queryByText("Generated suggestion")).not.toBeInTheDocument();
});
it("closing cancels pending generation and ignores a late response", async () => {
  let finish!: (value: unknown) => void;
  const fetch = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; })); vi.stubGlobal("fetch", fetch);
  open(); fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
  expect(screen.getByRole("button", { name: "Create draft" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "New draft" }));
  finish({ ok: true, json: async () => ({ caption: "Stale", hashtags: [] }) });
  await waitFor(() => expect(screen.getByRole("button", { name: "Generate with AI" })).toBeEnabled());
  expect(screen.queryByText("Stale")).not.toBeInTheDocument();
});
