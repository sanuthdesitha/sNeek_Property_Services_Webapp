import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module before importing suppression
const findFirstMock = vi.fn();
const updateManyMock = vi.fn();
const findManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findFirst: (...args: any[]) => findFirstMock(...args),
      updateMany: (...args: any[]) => updateManyMock(...args),
      findMany: (...args: any[]) => findManyMock(...args),
    },
  },
}));

import {
  isSuppressed,
  suppress,
  unsuppress,
  listSuppressed,
} from "@/lib/email/suppression";

describe("email suppression", () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    updateManyMock.mockReset();
    findManyMock.mockReset();
  });

  describe("isSuppressed", () => {
    it("returns false for empty email", async () => {
      expect(await isSuppressed("")).toBe(false);
      expect(findFirstMock).not.toHaveBeenCalled();
    });

    it("returns false for non-existent user", async () => {
      findFirstMock.mockResolvedValue(null);
      expect(await isSuppressed("nobody@example.com")).toBe(false);
    });

    it("returns false for OK status", async () => {
      findFirstMock.mockResolvedValue({ emailStatus: "OK" });
      expect(await isSuppressed("ok@example.com")).toBe(false);
    });

    it("returns true for HARD_BOUNCE", async () => {
      findFirstMock.mockResolvedValue({ emailStatus: "HARD_BOUNCE" });
      expect(await isSuppressed("hard@example.com")).toBe(true);
    });

    it("returns true for COMPLAINT", async () => {
      findFirstMock.mockResolvedValue({ emailStatus: "COMPLAINT" });
      expect(await isSuppressed("spam@example.com")).toBe(true);
    });

    it("returns true for SOFT_BOUNCE", async () => {
      findFirstMock.mockResolvedValue({ emailStatus: "SOFT_BOUNCE" });
      expect(await isSuppressed("soft@example.com")).toBe(true);
    });

    it("returns true for UNSUBSCRIBED", async () => {
      findFirstMock.mockResolvedValue({ emailStatus: "UNSUBSCRIBED" });
      expect(await isSuppressed("unsub@example.com")).toBe(true);
    });
  });

  describe("suppress", () => {
    it("calls updateMany with the right reason", async () => {
      updateManyMock.mockResolvedValue({ count: 1 });
      await suppress("hard@example.com", "HARD_BOUNCE");
      expect(updateManyMock).toHaveBeenCalledWith({
        where: { email: "hard@example.com" },
        data: { emailStatus: "HARD_BOUNCE" },
      });
    });

    it("is idempotent when user doesn't exist (updateMany returns 0)", async () => {
      updateManyMock.mockResolvedValue({ count: 0 });
      await expect(
        suppress("missing@example.com", "COMPLAINT")
      ).resolves.not.toThrow();
    });
  });

  describe("unsuppress", () => {
    it("sets emailStatus back to OK", async () => {
      updateManyMock.mockResolvedValue({ count: 1 });
      await unsuppress("hard@example.com");
      expect(updateManyMock).toHaveBeenCalledWith({
        where: { email: "hard@example.com" },
        data: { emailStatus: "OK" },
      });
    });
  });

  describe("listSuppressed", () => {
    it("returns mapped rows", async () => {
      findManyMock.mockResolvedValue([
        {
          email: "a@example.com",
          emailStatus: "HARD_BOUNCE",
          name: "Alice",
          updatedAt: new Date(),
        },
        {
          email: "b@example.com",
          emailStatus: "COMPLAINT",
          name: null,
          updatedAt: new Date(),
        },
      ]);
      const result = await listSuppressed(50);
      expect(result).toEqual([
        { email: "a@example.com", status: "HARD_BOUNCE", name: "Alice" },
        { email: "b@example.com", status: "COMPLAINT", name: null },
      ]);
      expect(findManyMock).toHaveBeenCalledWith({
        where: { emailStatus: { not: "OK" } },
        select: { email: true, emailStatus: true, name: true, updatedAt: true },
        take: 50,
        orderBy: { updatedAt: "desc" },
      });
    });

    it("uses default limit of 100", async () => {
      findManyMock.mockResolvedValue([]);
      await listSuppressed();
      expect(findManyMock).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 })
      );
    });
  });
});
