import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessMediaGallery, SubmissionReview, type SubmissionRow } from "@/components/v2/admin/jobs/submission-review";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/components/shared/media-gallery", () => ({
  MediaGallery: ({ items, onReload }: any) => <div>
    {items.map((item: any) => <a key={item.id} href={item.url}>{item.label ?? item.id}</a>)}
    <button onClick={onReload}>Refresh gallery</button>
  </div>,
}));
const response = (url: unknown, ok = true) => ({ ok, json: async () => ({ url }) });
const media = [{ id: "proof", s3Key: "jobs/a b/proof", url: null, label: "Photo proof", mediaType: "PHOTO" }];
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("submitted evidence access", () => {
  it("requests encoded job-scoped keys once and retains direct legacy media", async () => {
    fetchMock.mockResolvedValue(response("/fresh"));
    render(<AccessMediaGallery jobId="job/a b" media={[
      ...media, { ...media[0], id: "duplicate", label: "Duplicate proof" },
      { id: "legacy", s3Key: null, url: "/legacy", label: null },
      { id: "missing", s3Key: null, url: null, label: null },
    ]} />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/uploads/access?key=jobs%2Fa%20b%2Fproof&jobId=job%2Fa%20b");
    expect(screen.getByRole("link", { name: "Photo proof" })).toHaveAttribute("href", "/fresh");
    expect(screen.getByRole("link", { name: "Duplicate proof" })).toHaveAttribute("href", "/fresh");
    expect(screen.getByRole("link", { name: "legacy" })).toHaveAttribute("href", "/legacy");
    expect(screen.queryByRole("link", { name: "missing" })).toBeNull();
  });

  it.each(["denied", "empty", "invalid-json", "network"])("shows %s access failure and permits explicit recovery", async (failure) => {
    if (failure === "network") fetchMock.mockRejectedValueOnce(new Error("offline"));
    else if (failure === "invalid-json") fetchMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error("bad JSON"); } });
    else fetchMock.mockResolvedValueOnce(response("", failure !== "denied"));
    fetchMock.mockResolvedValue(response("/recovered"));
    render(<AccessMediaGallery jobId="j" media={media} />);
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reload media" }));
    await flush();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("renews before expiry and on focus, then removes timers/listeners on unmount", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(response("/first")).mockResolvedValueOnce(response("/timer")).mockResolvedValue(response("/focus"));
    const view = render(<AccessMediaGallery jobId="j" media={media} />); await flush();
    await act(async () => { vi.advanceTimersByTime(8 * 60_000); });
    expect(screen.getByRole("link")).toHaveAttribute("href", "/timer");
    fireEvent.focus(window); await flush();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/focus");
    view.unmount();
    vi.advanceTimersByTime(8 * 60_000); fireEvent.focus(window); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("ignores a previous job's response after job selection changes", async () => {
    const old = deferred(); fetchMock.mockReturnValueOnce(old.promise).mockResolvedValue(response("/new-job"));
    const view = render(<AccessMediaGallery jobId="old" media={media} />);
    view.rerender(<AccessMediaGallery jobId="new" media={media} />); await flush();
    old.resolve(response("/old-job")); await flush();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/new-job");
  });

  it.each([true, false])("ignores a slow earlier refresh (success=%s) after a newer refresh", async (ok) => {
    const slow = deferred(); fetchMock.mockReturnValueOnce(slow.promise).mockResolvedValue(response("/newest"));
    render(<AccessMediaGallery jobId="j" media={media} />);
    fireEvent.focus(window); await flush();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/newest");
    slow.resolve(response("/old", ok)); await flush();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/newest");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uses the submitted schema label for proof, retaining legacy labels for unmapped fields", async () => {
    const submission: SubmissionRow = {
      id: "s", createdAt: "2026-10-03T12:00:00Z", data: {}, laundryReady: null,
      laundryOutcome: null, bagLocation: null, autoQaScore: null, templateName: "Submitted template",
      submittedBy: "Cleaner", stockTxs: [], schema: { sections: [{ id: "section", label: "Evidence", fields: [{ id: "balcony", label: "Balcony floor proof", type: "photo" }] }] },
      media: [{ id: "mapped", fieldId: "balcony", label: "IMG_123", mediaType: "PHOTO", url: "/balcony", s3Key: "" },
        { id: "legacy", fieldId: "removed", label: "Legacy evidence", mediaType: "PHOTO", url: "/legacy", s3Key: "" }],
    };
    render(<SubmissionReview jobId="j" submissions={[submission]} property={{}} reworkFlags={["balcony"]} />); await flush();
    expect(screen.getAllByRole("link", { name: "Balcony floor proof" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Legacy evidence" })).toHaveAttribute("href", "/legacy");
    expect(screen.queryByText("IMG_123")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
