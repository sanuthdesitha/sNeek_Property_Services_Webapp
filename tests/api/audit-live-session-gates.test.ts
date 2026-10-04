// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), mutate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth, requireSession: m.auth }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.read }, uploadFailure: { findMany: m.read, update: m.mutate }, job: { findUnique: m.read }, notificationLog: { findMany: m.read, groupBy: m.read }, clientNotificationPreference: { findUnique: m.read, upsert: m.mutate } } }));
vi.mock("@/lib/email/suppression", () => ({ listSuppressed: m.read, unsuppress: m.mutate }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.mutate }));
vi.mock("@/lib/gps/geofence", () => ({ checkGeofenceForPing: m.mutate }));
vi.mock("@/lib/gps/departure-clockout", () => ({ handleGeofenceDeparture: m.mutate }));
vi.mock("@/lib/maps/server-key", () => ({ getServerMapsKey: m.read }));
import { GET as email } from "@/app/api/admin/system/email/route";
import { POST as unsuppress } from "@/app/api/admin/system/email/[email]/unsuppress/route";
import { GET as uploads } from "@/app/api/admin/system/uploads/route";
import { POST as resolve } from "@/app/api/admin/system/uploads/[id]/resolve/route";
import { GET as diagnostics } from "@/app/api/admin/system/diagnostics/route";
import { POST as invite } from "@/app/api/admin/qa/invites/route";
import { POST as geocode } from "@/app/api/geocode/lookup/route";
import { POST as ping } from "@/app/api/cleaner/location/ping/route";
import { GET as prefsGet, PATCH as prefsPatch } from "@/app/api/me/client-notification-preferences/route";
const req = () => new NextRequest("http://localhost", { method: "POST", body: "{}" });
beforeEach(() => { vi.resetAllMocks(); m.auth.mockRejectedValue(new Error("UNAUTHORIZED")); });
it.each([
  ["email", () => email(req())], ["unsuppress", () => unsuppress(req(), { params: { email: "test@example.invalid" } })],
  ["uploads", () => uploads(req())], ["resolve", () => resolve(req(), { params: { id: "upload" } })],
  ["diagnostics", () => diagnostics()], ["invite", () => invite(req())], ["geocode", () => geocode(req())], ["ping", () => ping(req())],
  ["preferences GET", () => prefsGet()], ["preferences PATCH", () => prefsPatch(req())],
] as const)("%s verifies a live session before querying or changing business records", async (_name, run) => {
  expect([401, 403]).toContain((await run()).status);
  expect(m.auth).toHaveBeenCalledTimes(1); expect(m.read).not.toHaveBeenCalled(); expect(m.mutate).not.toHaveBeenCalled();
});
