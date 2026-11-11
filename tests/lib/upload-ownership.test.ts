import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  jobAssignment: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import {
  isOwnUploadKey,
  uploadFolderAllowedForRole,
  uploadKeyOwnerId,
  uploadKeysNotOwnedBy,
} from "@/lib/uploads/ownership";
import { findForeignUploadKeys } from "@/lib/uploads/ownership-server";

describe("upload key ownership", () => {
  it("reads the uploader from the segment before the file name", () => {
    expect(uploadKeyOwnerId("evidence/user-1/abc.jpg")).toBe("user-1");
    expect(uploadKeyOwnerId("forms/job-1/capture-1/user-1/abc.jpg")).toBe("user-1");
    expect(uploadKeyOwnerId("laundry/pickup/user-2/abc.jpg")).toBe("user-2");
  });

  it("refuses keys with no readable owner", () => {
    expect(uploadKeyOwnerId("abc.jpg")).toBeNull();
    expect(uploadKeyOwnerId("evidence/abc.jpg")).toBeNull();
    expect(uploadKeyOwnerId("evidence/../user-1/abc.jpg")).toBeNull();
    expect(uploadKeyOwnerId("evidence//abc.jpg")).toBeNull();
    expect(uploadKeyOwnerId("evidence/user 1/abc.jpg")).toBeNull();
    expect(uploadKeyOwnerId("evidence\\user-1\\abc.jpg")).toBeNull();
    expect(uploadKeyOwnerId(undefined)).toBeNull();
  });

  it("does not treat an unreadable key as the caller's", () => {
    expect(isOwnUploadKey("evidence/user-1/abc.jpg", "user-1")).toBe(true);
    expect(isOwnUploadKey("evidence/user-2/abc.jpg", "user-1")).toBe(false);
    expect(isOwnUploadKey("abc.jpg", "user-1")).toBe(false);
    expect(uploadKeysNotOwnedBy(["evidence/user-1/a.jpg", "evidence/user-2/b.jpg", "c.jpg"], ["user-1"])).toEqual([
      "evidence/user-2/b.jpg",
      "c.jpg",
    ]);
  });
});

describe("upload folders by role", () => {
  it("keeps field roles out of office folders", () => {
    for (const role of ["CLEANER", "CLIENT", "LAUNDRY", "MAINTENANCE"]) {
      expect(uploadFolderAllowedForRole("branding", role)).toBe(false);
      expect(uploadFolderAllowedForRole("website/blog", role)).toBe(false);
      expect(uploadFolderAllowedForRole("property-access", role)).toBe(false);
      expect(uploadFolderAllowedForRole("Jobs/Reference", role)).toBe(false);
    }
  });

  it("leaves field evidence folders and office roles alone", () => {
    for (const folder of ["evidence", "forms/job-1/capture-1", "laundry/pickup", "cases", "staff-documents", "shopping-receipts", "lost-found", "uploads", "pay-adjustments", "brandingx"]) {
      expect(uploadFolderAllowedForRole(folder, "CLEANER")).toBe(true);
    }
    for (const role of ["ADMIN", "OPS_MANAGER", "QA_INSPECTOR", "VA"]) {
      expect(uploadFolderAllowedForRole("branding", role)).toBe(true);
    }
  });
});

describe("findForeignUploadKeys", () => {
  beforeEach(() => {
    db.jobAssignment.findMany.mockReset().mockResolvedValue([]);
    db.user.findMany.mockReset().mockResolvedValue([]);
  });

  it("accepts the caller's own keys without any lookup", async () => {
    const foreign = await findForeignUploadKeys({ keys: ["evidence/me/a.jpg", undefined, ""], callerId: "me" });
    expect(foreign).toEqual([]);
    expect(db.jobAssignment.findMany).not.toHaveBeenCalled();
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("rejects another person's key and an unreadable key", async () => {
    const foreign = await findForeignUploadKeys({ keys: ["evidence/other/a.jpg", "loose.jpg"], callerId: "me" });
    expect(foreign).toEqual(["evidence/other/a.jpg", "loose.jpg"]);
  });

  it("accepts a co-cleaner assigned to the same job, but only for that job", async () => {
    db.jobAssignment.findMany.mockResolvedValue([{ userId: "mate" }]);
    expect(await findForeignUploadKeys({ keys: ["evidence/mate/a.jpg"], callerId: "me", jobId: "job-1" })).toEqual([]);
    expect(db.jobAssignment.findMany).toHaveBeenCalledWith({
      where: { jobId: "job-1", userId: { in: ["mate"] } },
      select: { userId: true },
    });
    expect(await findForeignUploadKeys({ keys: ["evidence/mate/a.jpg"], callerId: "me" })).toEqual(["evidence/mate/a.jpg"]);
  });

  it("accepts files the office attached", async () => {
    db.user.findMany.mockResolvedValue([{ id: "office" }]);
    expect(await findForeignUploadKeys({ keys: ["evidence/office/a.jpg", "evidence/stranger/b.jpg"], callerId: "me", jobId: "job-1" })).toEqual([
      "evidence/stranger/b.jpg",
    ]);
  });

  it("does not re-judge keys already stored on the record", async () => {
    const foreign = await findForeignUploadKeys({ keys: ["evidence/other/a.jpg"], callerId: "me", knownKeys: ["evidence/other/a.jpg"] });
    expect(foreign).toEqual([]);
  });
});
