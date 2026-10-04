// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), property: vi.fn(), update: vi.fn(), save: vi.fn(), audit: vi.fn(), library: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({ db: { property: { findUnique: m.property, update: m.update }, propertyChecklistProfile: { upsert: m.save }, auditLog: { create: m.audit } } }));
vi.mock("@/lib/checklists/library", () => ({ CATALOG_VERSION: "7", getChecklistLibrary: m.library }));
vi.mock("@/lib/checklists/compose", async original => ({ ...await original<any>(), generatePropertyTemplates: m.generate }));
import { GET, PUT, POST } from "@/app/api/admin/properties/[id]/checklist-profile/route";
const params = { params: { id: "p" } };
const request = (method = "GET", body?: any, query = "") => new NextRequest(`http://localhost/api/admin/properties/p/checklist-profile${query}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
beforeEach(() => { vi.resetAllMocks(); m.auth.mockResolvedValue({ user: { id: "admin" } }); m.property.mockResolvedValue({ id: "p", name: "Home", features: {}, checklistProfile: null }); m.library.mockResolvedValue([]); m.save.mockResolvedValue({ status: "DRAFT" }); m.generate.mockResolvedValue({ generated: { AIRBNB_TURNOVER: "template" } }); });
it("empty library GET reads without seed or draft writes", async () => {
 const res = await GET(request(), params); expect(res.status).toBe(200); const body = await res.json();
 expect(body.library).toEqual([]); expect(body.profile).toBeNull(); expect(body.catalogVersion).toBe("7");
 expect(m.library).toHaveBeenCalledOnce(); expect(m.save).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled();
});
it("saved selection remains authoritative; invalid preview type produces no schema", async () => {
 m.property.mockResolvedValue({ id: "p", name: "Home", features: {}, checklistProfile: { selections: { modules: { room: { enabled: false, items: {} } }, customItems: [] }, status: "APPROVED", syncedLibraryVersion: "6" } });
 const body = await (await GET(request("GET", undefined, "?previewJobType=INVALID"), params)).json();
 expect(body.selections.modules.room.enabled).toBe(false); expect(body.preview).toBeNull(); expect(body.profile.generatedTemplateIds).toEqual({});
});
it("draft save sanitizes property instructions/cadence without publishing", async () => {
 const res = await PUT(request("PUT", { selections: { modules: { room: { enabled: true, items: { detail: { enabled: true, rotationEveryNCleans: 3, instructions: " Soil check " } } } } }, features: { livePlants: true } }), params);
 expect(res.status).toBe(200); expect(m.save.mock.calls[0][0].update).toMatchObject({ status: "DRAFT", selections: { modules: { room: { items: { detail: { rotationEveryNCleans: 3, instructions: "Soil check" } } } } } });
 expect(m.update).toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled(); expect(m.audit).toHaveBeenCalled();
});
it("saving selections alone leaves features untouched; explicit approval delegates requested types", async () => {
 await PUT(request("PUT", { selections: {} }), params); expect(m.update).not.toHaveBeenCalled();
 expect((await POST(request("POST", { jobTypes: ["AIRBNB_TURNOVER"] }), params)).status).toBe(200);
 expect(m.generate).toHaveBeenCalledWith({ propertyId: "p", jobTypes: ["AIRBNB_TURNOVER"], actorUserId: "admin" });
});
it.each([GET, PUT])("missing property is not written", async handler => {
 m.property.mockResolvedValue(null); expect((await handler(request(handler === GET ? "GET" : "PUT", handler === GET ? undefined : { selections: {} }), params)).status).toBe(404); expect(m.save).not.toHaveBeenCalled();
});
it.each([GET, PUT, POST])("authorization gates every profile operation", async handler => {
 for (const [message, status] of [["UNAUTHORIZED",401],["FORBIDDEN",403],["unavailable",400]] as const) {
  m.auth.mockRejectedValue(new Error(message)); expect((await handler(request(), params)).status).toBe(status);
 }
 expect(m.library).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled();
});
