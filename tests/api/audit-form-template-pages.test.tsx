// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: "ADMIN", findUnique: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async (roles: string[]) => {
  if (!m.role) throw new Error("UNAUTHORIZED");
  if (!roles.includes(m.role)) throw new Error("FORBIDDEN");
  return { user: { id: "viewer", role: m.role } };
} }));
vi.mock("@/lib/db", () => ({ db: { formTemplate: { findUnique: m.findUnique } } }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/components/v2/admin/forms/management/new-form-launcher", () => ({ NewFormLauncher: () => null }));
vi.mock("@/components/v2/admin/forms/builder/form-builder", () => ({ EstateFormBuilder: () => null }));
vi.mock("@/components/forms/form-builder", () => ({ FormBuilder: () => null }));
import Layout from "@/app/admin/forms/new/layout";
import NewPage from "@/app/v2/admin/forms/new/page";
import EditPage from "@/app/v2/admin/forms/[id]/edit/page";
import LegacyEditPage from "@/app/admin/forms/[id]/edit/page";
const params = { params: { id: "template" } };
beforeEach(() => {
  vi.clearAllMocks(); m.role = "ADMIN";
  m.findUnique.mockResolvedValue({ id: "template", name: "Inspection", kind: "CUSTOM", serviceType: "GENERAL_CLEAN", schema: { standardSections: false, sections: [] }, isActive: false, archivedAt: null, version: 2, updatedAt: new Date("2026-10-03T00:00:00Z") });
});
const gates = [
  ["legacy new layout", () => Layout({ children: "protected editor" })],
  ["new page", () => NewPage()],
  ["edit page", () => EditPage(params)],
  ["legacy edit page", () => LegacyEditPage(params)],
] as const;
it.each(gates)("blocks OPS at %s before loading template data", async (_name, render) => {
  m.role = "OPS_MANAGER";
  await expect(render()).rejects.toThrow("FORBIDDEN");
  expect(m.findUnique).not.toHaveBeenCalled();
});
it.each(gates)("requires a live session at %s", async (_name, render) => {
  m.role = "";
  await expect(render()).rejects.toThrow("UNAUTHORIZED");
  expect(m.findUnique).not.toHaveBeenCalled();
});
it("returns protected new editor content only after ADMIN admission", async () => {
  expect(await Layout({ children: "protected editor" })).toBe("protected editor");
  expect((await NewPage()).type).toBeTypeOf("function");
});
it.each([["estate", EditPage], ["legacy", LegacyEditPage]] as const)("loads %s editor for ADMIN with template version preserved", async (_name, render) => {
  const page = await render(params);
  expect(page.props.templateId).toBe("template");
  expect(page.props.initialUpdatedAt).toBe("2026-10-03T00:00:00.000Z");
  expect(page.props.initialSchema.standardSections).toBe(false);
});
it.each([["estate", EditPage], ["legacy", LegacyEditPage]] as const)("returns not-found for missing %s template after ADMIN admission", async (_name, render) => {
  m.findUnique.mockResolvedValue(null);
  await expect(render(params)).rejects.toThrow("NOT_FOUND");
});
