import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Role } from "@prisma/client";
import { canActAs } from "@/lib/auth/roles";
const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/db", () => ({ db: { user: { findMany: mocks.findMany } } }));
import Page from "@/app/v2/admin/cleaners/addresses/page";

beforeEach(() => { vi.clearAllMocks(); mocks.requireRole.mockResolvedValue({ user: { role: Role.ADMIN } }); });
it("reads only existing minimal address fields and renders them for an admin", async () => {
  mocks.findMany.mockResolvedValue([{ id: "c1", name: "Cleaner One", address: "12 Test Street", suburb: "Testville" },
    { id: "c2", name: "Cleaner Two", address: null, suburb: null }]);
  render(await Page());
  expect(mocks.requireRole).toHaveBeenCalledWith([Role.ADMIN]);
  expect(mocks.requireRole.mock.invocationCallOrder[0]).toBeLessThan(mocks.findMany.mock.invocationCallOrder[0]);
  expect(mocks.findMany).toHaveBeenCalledWith({
    where: { isActive: true, OR: [{ role: Role.CLEANER }, { extraRoles: { some: { role: Role.CLEANER } } }] },
    select: { id: true, name: true, address: true, suburb: true },
    orderBy: [{ suburb: "asc" }, { name: "asc" }, { id: "asc" }],
  });
  expect(screen.getByText("12 Test Street")).toBeInTheDocument();
  expect(screen.getByText("Testville")).toBeInTheDocument();
  expect(screen.getAllByText("Not recorded")).toHaveLength(2);
});
it.each([Role.OPS_MANAGER, Role.CLEANER, Role.CLIENT])("denies %s before reading residential data", async role => {
  mocks.requireRole.mockImplementation(async allowed => {
    if (!canActAs([role], allowed)) throw new Error("FORBIDDEN");
  });
  await expect(Page()).rejects.toThrow("FORBIDDEN");
  expect(mocks.findMany).not.toHaveBeenCalled();
});
it("denies unauthenticated access before reading residential data", async () => {
  mocks.requireRole.mockRejectedValue(new Error("UNAUTHORIZED"));
  await expect(Page()).rejects.toThrow("UNAUTHORIZED");
  expect(mocks.findMany).not.toHaveBeenCalled();
});
it("renders the empty team without requesting unrelated profile fields", async () => {
  mocks.findMany.mockResolvedValue([]);
  render(await Page());
  expect(screen.getByText("No active cleaners.")).toBeInTheDocument();
});
