import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WEBSITE_CONTENT, type WebsiteContent } from "@/lib/public-site/content";

const env = vi.hoisted(() => ({ phone: false, toast: vi.fn() }));
vi.mock("@/components/v2/ui/use-phone", () => ({ useIsPhone: () => env.phone }));
vi.mock("@/hooks/use-toast", () => ({ toast: env.toast }));
vi.mock("@/components/v2/ui/undo-toast", () => ({ undoToast: vi.fn() }));

import { WebsiteCmsEditor } from "@/components/v2/admin/website/editor/website-editor";
import { BlogWorkspace } from "@/components/v2/admin/website/blog/blog-workspace";

const fetchMock = vi.fn();
const content = (): WebsiteContent => JSON.parse(JSON.stringify(DEFAULT_WEBSITE_CONTENT));
const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  env.phone = false;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
  window.history.replaceState(null, "", "/v2/admin/website");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderEditor(readOnly = false) {
  return render(<WebsiteCmsEditor initialContent={content()} initialRevision="rev-1" readOnly={readOnly} draftOwnerId="admin-1" timeZone="Australia/Sydney" />);
}

describe("website editor", () => {
  it("counts and outlines unsaved changes; the preview never saves them", async () => {
    renderEditor();
    const headline = screen.getByLabelText(/^Headline/);
    fireEvent.change(headline, { target: { value: "Airbnb turnovers, done before check-in" } });
    expect(screen.getByRole("status", { name: "" }).textContent ?? "").toContain("1 unsaved change");
    expect(screen.getByText(/Home › hero headline/)).toBeInTheDocument();
    expect(screen.getByText(/changed · was/)).toBeInTheDocument();
    expect(headline.className).toMatch(/outline/);
    expect(screen.getByTitle("Website preview with unsaved changes")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 600));
    // Typing and previewing never call the server; only Save and publish does.
    expect(fetchMock).not.toHaveBeenCalled();
    // The draft is kept on this browser until published or discarded.
    expect(window.localStorage.getItem("sneek:website-draft:v1:admin-1")).toContain("Airbnb turnovers, done before check-in");
  });

  it("publishes with the revision it started from, and keeps the draft when someone else published", async () => {
    const theirs = content();
    theirs.home.eyebrow = "Ravi's eyebrow";
    fetchMock.mockResolvedValueOnce(ok({ code: "website_changed", publishedByName: "Ravi Mehta", publishedAt: "2026-11-14T23:12:00Z", websiteContent: theirs, websiteRevision: "rev-2", error: "x" }, 409));
    renderEditor();
    fireEvent.change(screen.getByLabelText(/^Headline/), { target: { value: "My headline" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save and publish" })[0]!);
    await screen.findByText(/Ravi Mehta published the website at Sun 15 Nov 10:12/);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body)).toMatchObject({ websiteRevision: "rev-1", websiteContent: { home: { title: "My headline" } } });
    expect(screen.getByLabelText(/^Headline/)).toHaveValue("My headline");
    expect(screen.getByText(/Nothing was published/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(screen.getByText(/Publishing yours would change: Home › hero eyebrow, hero headline/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    fetchMock.mockResolvedValueOnce(ok({ websiteContent: { ...theirs, home: { ...theirs.home, title: "My headline" } }, websiteRevision: "rev-3" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Save and publish/ })[0]!);
    await screen.findByText(/Published. The live site now shows these changes/);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).websiteRevision).toBe("rev-2");
  });

  it("will not publish an image without alt text and says which one", async () => {
    renderEditor();
    fireEvent.change(screen.getAllByLabelText(/^Alt text/)[0]!, { target: { value: "" } });
    expect(screen.getByText(/cannot be published while this image has none/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Save and publish" })[0]!);
    expect(await screen.findByText(/Add alt text before publishing: Home hero image/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("operations managers see it read only and cannot publish", () => {
    renderEditor(true);
    expect(screen.getByText("Only administrators can publish website changes. The preview still works.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save and publish/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Headline/)).toBeDisabled();
  });

  it("on a phone the publish action docks at the bottom and the panes become Edit / Preview steps", () => {
    env.phone = true;
    renderEditor();
    fireEvent.change(screen.getByLabelText(/^Headline/), { target: { value: "Phone headline" } });
    const bar = screen.getByRole("region", { name: "Website actions" });
    expect(within(bar).getByRole("button", { name: "Save and publish (1)" })).toBeEnabled();
    expect(screen.getByRole("group", { name: "Editor panes" })).toBeInTheDocument();
    expect(screen.getByLabelText("Section")).toBeInTheDocument();
  });
});

describe("blog workspace", () => {
  const posts = [
    { id: "p1", slug: "turnover-in-90-minutes", title: "How we turn over a property in 90 minutes", excerpt: "From strip-down to restock.", body: "## 1", coverImageUrl: null, tags: ["airbnb"], isPublished: false, publishedAt: null, updatedAt: "2026-11-10T05:20:00Z", authorName: "sNeek Team" },
    { id: "p2", slug: "summer-checklist", title: "Summer guest checklist", excerpt: "Checklist.", body: "Body", coverImageUrl: null, tags: [], isPublished: true, publishedAt: "2099-12-01T07:00:00Z", updatedAt: "2026-11-10T05:20:00Z", authorName: "Hannah Lee" },
    { id: "p3", slug: "linen", title: "Linen: own it or hire it?", excerpt: "Linen.", body: "Body", coverImageUrl: null, tags: [], isPublished: true, publishedAt: "2026-10-28T00:00:00Z", updatedAt: "2026-10-28T00:00:00Z", authorName: "sNeek Team" },
  ];

  it("shows Draft, Scheduled and Published with real counts", async () => {
    fetchMock.mockResolvedValue(ok(posts));
    render(<BlogWorkspace timeZone="Australia/Sydney" />);
    await screen.findByText("Summer guest checklist");
    expect(screen.getByRole("button", { name: /Scheduled\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Drafts\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Published\s*1/ })).toBeInTheDocument();
  });

  it("a load failure is an error with retry, never 'No posts yet'", async () => {
    fetchMock.mockResolvedValue(ok({ error: "Posts could not be loaded." }, 500));
    render(<BlogWorkspace timeZone="Australia/Sydney" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Posts could not be loaded.");
    expect(screen.queryByText(/No posts yet/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("a future publish time schedules the post (tier A says it stays off the site) and sends the organisation-time instant", async () => {
    fetchMock.mockResolvedValueOnce(ok(posts)).mockResolvedValueOnce(ok({ ...posts[0], isPublished: true, publishedAt: "2099-12-01T07:00:00.000Z" }));
    render(<BlogWorkspace timeZone="Australia/Sydney" />);
    fireEvent.click(await screen.findByRole("button", { name: "How we turn over a property in 90 minutes" }));
    fireEvent.change(screen.getByLabelText(/Publish time/), { target: { value: "2099-12-01T18:00" } });
    expect(screen.getByText(/Public site › blog › turnover-in-90-minutes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Schedule…" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/stays off the public site until/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Schedule post" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/admin/blog-posts/p1");
    expect(body).toMatchObject({ isPublished: true, publishedAt: "2099-12-01T07:00:00.000Z" });
  });
});
