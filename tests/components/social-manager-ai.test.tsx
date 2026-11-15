import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SocialManager } from "@/components/v2/admin/marketing/social-manager";
afterEach(() => vi.unstubAllGlobals());

function typeTopic() {
  fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "Airbnb cleaning in Sydney" } });
}

it("suggests a caption only on request and saves nothing until the post is saved", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ caption: "A clean welcome.", hashtags: ["#Sydney"], suggestedHook: "Welcome" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ post: { id: "1", caption: "A clean welcome.\n\n#Sydney", channel: "INSTAGRAM", status: "DRAFT", createdAt: new Date().toISOString() } }) });
  vi.stubGlobal("fetch", fetch);
  render(<SocialManager initialPosts={[]} onToast={vi.fn()} />);
  typeTopic();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Suggest a caption" }));
  await screen.findByText("Suggestion, not saved");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ platform: "INSTAGRAM", topic: "Airbnb cleaning in Sydney", tone: "friendly" });
  fireEvent.click(screen.getByRole("button", { name: "Use this caption" }));
  expect(screen.getByLabelText("Caption")).toHaveValue("A clean welcome.\n\n#Sydney");
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Save post" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(fetch.mock.calls[1][0]).toBe("/api/admin/marketing/social");
  expect(JSON.parse(fetch.mock.calls[1][1].body).caption).toBe("A clean welcome.\n\n#Sydney");
});

it.each([false, true])("shows the failure and no suggestion when generation fails or is malformed (%s)", async (malformed) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: malformed, status: malformed ? 200 : 502, json: async () => (malformed ? { caption: 123 } : { error: "Model unavailable" }) }));
  render(<SocialManager initialPosts={[]} onToast={vi.fn()} />);
  typeTopic();
  fireEvent.click(screen.getByRole("button", { name: "Suggest a caption" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("Suggestion, not saved")).not.toBeInTheDocument();
});

it("says caption help is off when no AI provider is configured", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: "AI composition is not configured. Ask an administrator…" }) }));
  render(<SocialManager initialPosts={[]} onToast={vi.fn()} />);
  typeTopic();
  fireEvent.click(screen.getByRole("button", { name: "Suggest a caption" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Caption help is off. Write your own, or turn it on in AI configuration.");
});

it("leaving the tab cancels a pending suggestion", async () => {
  const fetch = vi.fn().mockImplementation(() => new Promise(() => undefined));
  vi.stubGlobal("fetch", fetch);
  const view = render(<SocialManager initialPosts={[]} onToast={vi.fn()} />);
  typeTopic();
  fireEvent.click(screen.getByRole("button", { name: "Suggest a caption" }));
  view.unmount();
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
});

it("never claims sNeek posted anything: planned posts wait for your link, posted ones are yours", () => {
  const base = { caption: "Before and after: Manly Loft", createdAt: "2026-11-10T00:00:00Z", externalUrl: null, publishedAt: null };
  render(
    <SocialManager
      onToast={vi.fn()}
      initialPosts={[
        { ...base, id: "a", channel: "INSTAGRAM", status: "SCHEDULED", scheduledFor: "2026-11-13T07:00:00Z" },
        { ...base, id: "b", channel: "FACEBOOK", status: "PUBLISHED", scheduledFor: null, publishedAt: "2026-11-06T00:00:00Z", externalUrl: "https://facebook.example/post" },
        { ...base, id: "c", channel: "TIKTOK", status: "DRAFT", scheduledFor: null },
      ]}
    />
  );
  expect(screen.getByText("Waiting for your link")).toBeInTheDocument();
  expect(screen.getByText("Posted by you")).toBeInTheDocument();
  expect(screen.getByText(/planned for Fri 13 Nov 18:00/)).toBeInTheDocument();
  expect(screen.getByText(/sNeek does not post to Instagram, Facebook, TikTok or YouTube, and does not send reminders/)).toBeInTheDocument();
  expect(screen.queryByText(/^Published$|^Scheduled$|Publish now|Post now/)).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Paste the link…" })).toHaveLength(2);
});
