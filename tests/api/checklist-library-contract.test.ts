// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), library: vi.fn(), find: vi.fn(), order: vi.fn(), create: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/checklists/library", () => ({ getChecklistLibrary: m.library }));
vi.mock("@/lib/db", () => ({ db: { checklistModule: { findUnique: m.find, aggregate: m.order, create: m.create }, auditLog: { create: m.audit } } }));
import { GET, POST } from "@/app/api/admin/checklist-library/route";
const request = (body: any) => new NextRequest("http://localhost", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); m.auth.mockResolvedValue({ user: { id: "admin" } }); m.library.mockResolvedValue([]); m.order.mockResolvedValue({ _max: { sortOrder: null } }); m.create.mockImplementation(async ({ data }) => ({ id: "module", ...data })); });
it("library GET includes inactive rows without initializing or mutating", async () => {
 expect((await GET()).status).toBe(200); expect(m.library).toHaveBeenCalledWith({ includeInactive: true }); expect(m.create).not.toHaveBeenCalled();
});
it.each([{ key: "room", title: "Room" }, { key: "room", title: "Room", description: "Instructions", category: "ROOM", sortOrder: 45, appliesWhen: { feature: "plants" } }])("creates reviewed module and audit %j", async body => {
 const result = await POST(request(body)); expect(result.status).toBe(201);
 expect(m.create.mock.calls[0][0].data).toMatchObject({ key: "room", title: "Room", sortOrder: "sortOrder" in body ? 45 : 10 });
 expect(m.audit.mock.calls[0][0].data).toMatchObject({ entityId: "module", action: "CHECKLIST_MODULE_CREATE" });
});
it("existing maximum order is respected; duplicate key cannot overwrite", async () => {
 m.order.mockResolvedValue({ _max: { sortOrder: 70 } }); await POST(request({ key: "room", title: "Room" })); expect(m.create.mock.calls[0][0].data.sortOrder).toBe(80);
 m.create.mockClear(); m.find.mockResolvedValue({ id: "existing" }); expect((await POST(request({ key: "room", title: "Replacement" }))).status).toBe(409); expect(m.create).not.toHaveBeenCalled();
});
it.each([["UNAUTHORIZED",401],["FORBIDDEN",403],["unavailable",400]])("gates reads and creation for %s", async (message,status) => {
 m.auth.mockRejectedValue(new Error(String(message))); expect((await GET()).status).toBe(status); expect((await POST(request({ key: "room", title: "Room" }))).status).toBe(status); expect(m.create).not.toHaveBeenCalled();
});
