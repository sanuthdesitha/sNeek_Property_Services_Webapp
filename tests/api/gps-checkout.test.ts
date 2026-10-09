// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ role: vi.fn(), job: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/db", () => ({ db: { job: { findFirst: mocks.job }, $transaction: (fn: any) => fn({}) } }));
vi.mock("@/lib/jobs/checkout-location", () => ({ recordCheckoutLocation: mocks.record }));
import { POST } from "@/app/api/cleaner/jobs/[id]/gps-checkout/route";
const send = (body: unknown) => POST(new NextRequest("http://localhost/api/cleaner/jobs/job/gps-checkout", { method: "POST", body: JSON.stringify(body) }), { params: { id: "job" } });
beforeEach(() => {
 vi.resetAllMocks();
 mocks.role.mockResolvedValue({ user: { id: "cleaner" } });
 mocks.job.mockResolvedValue({ id: "job", property: { latitude: 1, longitude: 2 } });
 mocks.record.mockResolvedValue({ recorded: true });
});
it("requires a bound clock segment, including from old clients", async () => {
 expect((await send({ lat: 1, lng: 2 })).status).toBe(409);
 expect(mocks.record).not.toHaveBeenCalled();
});
it.each([{ lat: null, lng: 2 }, { lat: true, lng: 2 }, { lat: 91, lng: 2 }, { lat: 1, lng: 181 }])("rejects invalid coordinates %j", async body => {
 expect((await send({ ...body, timeLogId: "clock" })).status).toBe(400);
 expect(mocks.record).not.toHaveBeenCalled();
});
it("binds coordinates to authenticated cleaner and current assignment", async () => {
 const response = await send({ lat: 1, lng: 2, timeLogId: "clock", userId: "other" });
 expect(await response.json()).toMatchObject({ recorded: true, distanceMeters: 0 });
 expect(mocks.record).toHaveBeenCalledWith({}, { jobId: "job", userId: "cleaner", timeLogId: "clock", lat: 1, lng: 2 });
});
it("does not report stale coordinates as saved", async () => {
 mocks.record.mockResolvedValue({ recorded: false, reason: "CLOCK_OUT_ALREADY_RECORDED" });
 expect(await (await send({ lat: 1, lng: 2, timeLogId: "clock" })).json()).toEqual({ ok: true, recorded: false, reason: "CLOCK_OUT_ALREADY_RECORDED" });
});
it("denies revoked assignments", async () => {
 mocks.record.mockRejectedValue(new Error("FORBIDDEN"));
 expect((await send({ lat: 1, lng: 2, timeLogId: "clock" })).status).toBe(403);
});
it("denies unauthenticated requests", async () => {
 mocks.role.mockRejectedValue(new Error("UNAUTHORIZED"));
 expect((await send({ lat: 1, lng: 2, timeLogId: "clock" })).status).toBe(401);
});

it("does not expose another cleaner's job", async () => {
 mocks.job.mockResolvedValue(null);
 expect((await send({ lat: 1, lng: 2, timeLogId: "clock" })).status).toBe(404);
 expect(mocks.record).not.toHaveBeenCalled();
});
