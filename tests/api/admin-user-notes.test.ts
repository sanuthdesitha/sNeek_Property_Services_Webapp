// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ requireRole: vi.fn(), find: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.find, update: m.update }, auditLog: { create: m.audit } } }));

import { PUT } from "@/app/api/admin/users/[id]/notes/route";

const put = (notes: unknown) =>
  PUT(new NextRequest("http://localhost/api/admin/users/u1/notes", { method: "PUT", body: JSON.stringify({ notes }) }), { params: { id: "u1" } });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue({ user: { id: "admin" } });
  m.find.mockResolvedValue({ id: "u1", adminNotes: "old office note" });
  m.update.mockImplementation(async ({ data }: any) => ({ id: "u1", adminNotes: data.adminNotes }));
});

describe("the office's private note on an account", () => {
  it("is stored separately from the person's own notes", async () => {
    const response = await put("  Reliable; check visa in March.  ");
    expect(response.status).toBe(200);
    expect(m.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { adminNotes: "Reliable; check visa in March." },
      select: { id: true, adminNotes: true },
    });
    // The person's own "notes to admin" column is never written by this route.
    expect(JSON.stringify(m.update.mock.calls[0][0].data)).not.toContain('"notes"');
    expect(await response.json()).toEqual({ id: "u1", notes: "Reliable; check visa in March." });
  });

  it("records what changed", async () => {
    await put("new");
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: "admin", action: "UPDATE_USER_NOTES", entityId: "u1",
      before: { adminNotes: "old office note" }, after: { adminNotes: "new" },
    }) });
  });

  it("clears to empty rather than storing blank text", async () => {
    await put("   ");
    expect(m.update.mock.calls[0][0].data).toEqual({ adminNotes: null });
  });

  it("is limited to office roles", async () => {
    m.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await put("x")).status).toBe(403);
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
    expect(m.update).not.toHaveBeenCalled();
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("the private note never reaches a non-office surface", () => {
  // Everything a cleaner, client, laundry, QA or maintenance user loads.
  const roots = [
    "app/api/me", "app/api/cleaner", "app/api/client", "app/api/laundry", "app/api/qa",
    "app/api/maintenance", "app/api/jobs", "app/api/chat", "app/api/workforce",
    "app/v2/cleaner", "app/v2/client", "app/v2/laundry", "app/v2/qa", "app/v2/maintenance",
    "app/cleaner", "app/client", "app/laundry", "app/qa", "app/maintenance",
    "components/profile", "components/v2/cleaner", "components/v2/client", "components/v2/laundry",
  ];
  const offenders = roots
    .flatMap((root) => { try { return sourceFiles(root); } catch { return []; } })
    .filter((path) => readFileSync(path, "utf8").includes("adminNotes"));

  it("is not selected or referenced outside the office's own screens", () => {
    expect(offenders).toEqual([]);
  });

  it("is not accepted by the self-service profile endpoint", () => {
    expect(readFileSync("app/api/me/profile/route.ts", "utf8")).not.toContain("adminNotes");
  });
});
