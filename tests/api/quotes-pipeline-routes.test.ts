/**
 * GET /api/admin/quotes/pipeline (400 on unknown sort or stage, CSV with the
 * same roles) and POST …/bulk (each row through the existing lead PATCH or
 * quote send handler, refused rows with reasons).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ role: vi.fn(), load: vi.fn(), patchLead: vi.fn(), send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/quotes/pipeline", async (original) => ({ ...(await original<typeof import("@/lib/quotes/pipeline")>()), loadPipelineRows: m.load }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn() }));
vi.mock("@/app/api/admin/leads/[id]/route", () => ({ PATCH: m.patchLead }));
vi.mock("@/app/api/admin/quotes/[id]/send/route", () => ({ POST: m.send }));

import { GET } from "@/app/api/admin/quotes/pipeline/route";
import { POST } from "@/app/api/admin/quotes/pipeline/bulk/route";

beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue({ user: { id: "a", role: "ADMIN" } });
  m.load.mockResolvedValue([]);
  m.patchLead.mockResolvedValue(Response.json({ id: "l1", status: "LOST" }));
  m.send.mockImplementation(async (_req: NextRequest, { params }: { params: { id: string } }) =>
    params.id === "q2" ? Response.json({ error: "No recipient email found. Please provide an email address." }, { status: 400 }) : Response.json({ ok: true }),
  );
});

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/admin/quotes/pipeline?${qs}`));

describe("pipeline routes", () => {
  it("answers 401/403 and 400 for an unknown sort or stage", async () => {
    m.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await get("")).status).toBe(403);
    expect((await get("sort=margin")).status).toBe(400);
    expect((await get("stage=maybe")).status).toBe(400);
    const ok = await get("stage=open");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ rows: [], total: 0, counts: { open: 0 } });
  });

  it("returns CSV for ?format=csv", async () => {
    const response = await get("format=csv");
    expect(response.headers.get("content-type")).toContain("text/csv");
  });

  it("bulk send and mark lost go through the existing handlers with per-row outcomes", async () => {
    const send = await POST(new NextRequest("http://localhost/api/admin/quotes/pipeline/bulk", { method: "POST", body: JSON.stringify({ action: "send", rows: [{ kind: "quote", id: "q1" }, { kind: "quote", id: "q2" }, { kind: "lead", id: "l1" }] }) }));
    const body = await send.json();
    expect(body.outcomes.map((row: { status: string }) => row.status)).toEqual(["done", "refused", "refused"]);
    expect(body.outcomes[1].message).toMatch(/No recipient/);
    const lost = await POST(new NextRequest("http://localhost/api/admin/quotes/pipeline/bulk", { method: "POST", body: JSON.stringify({ action: "mark-lost", rows: [{ kind: "lead", id: "l1" }, { kind: "quote", id: "q1" }] }) }));
    const lostBody = await lost.json();
    expect(lostBody.outcomes.map((row: { status: string }) => row.status)).toEqual(["done", "refused"]);
    const [request] = m.patchLead.mock.calls[0] as [NextRequest];
    expect(await request.json()).toEqual({ status: "LOST" });
  });
});
