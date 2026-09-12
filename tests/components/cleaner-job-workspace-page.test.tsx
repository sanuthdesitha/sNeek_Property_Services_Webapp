import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ role: vi.fn(), findFirst: vi.fn(), notFound: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/db", () => ({ db: { job: { findFirst: mocks.findFirst } } }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/v2/cleaner/job-workspace", () => ({ JobWorkspace: () => null }));
import Page from "@/app/v2/cleaner/jobs/[id]/page";

describe("cleaner workspace mount scope", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.role.mockResolvedValue({ user: { id: "cleaner-a" } });
    mocks.findFirst.mockResolvedValue({ id: "job-a" });
    mocks.notFound.mockImplementation(() => { throw new Error("NOT_FOUND"); });
  });

  it("remounts for either a different job or effective cleaner", async () => {
    const first = await Page({ params: { id: "job-a" } });
    const otherJob = await Page({ params: { id: "job-b" } });
    mocks.role.mockResolvedValue({ user: { id: "cleaner-b" } });
    const otherCleaner = await Page({ params: { id: "job-a" } });
    expect(first.key).not.toBe(otherJob.key);
    expect(first.key).not.toBe(otherCleaner.key);
    expect(first.props.jobId).toBe("job-a");
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "job-a", assignments: { some: { userId: "cleaner-a", removedAt: null } } },
      select: { id: true },
    });
  });

  it("does not mount an unassigned job", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(Page({ params: { id: "job-a" } })).rejects.toThrow("NOT_FOUND");
  });

  it("separates different real actors impersonating the same cleaner", async () => {
    mocks.role.mockResolvedValue({ user: { id: "cleaner" }, impersonation: { actorId: "admin-a" } });
    const first = await Page({ params: { id: "job-a" } });
    mocks.role.mockResolvedValue({ user: { id: "cleaner" }, impersonation: { actorId: "admin-b" } });
    const second = await Page({ params: { id: "job-a" } });
    expect(first.key).not.toBe(second.key);
    expect(first.key).toBe(first.props.draftIdentity);
    expect(first.props.draftIdentity).toMatch(/^[a-f0-9]{64}$/);
  });
});
