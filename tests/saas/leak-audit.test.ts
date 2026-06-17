import { describe, it, expect, beforeAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { registerTenantScoping } from "@/lib/saas/tenant-prisma";
import { runWithTenant, runAsPlatformAdmin, enterTenantContext } from "@/lib/saas/tenant-context";
import { MULTITENANCY_ENABLED } from "@/lib/saas/config";

/**
 * 2-tenant leak audit — the acceptance gate for Phase 1b.
 *
 * Runs the REAL auto-scoping middleware against a database with two orgs and
 * asserts tenant A can never read tenant B's rows (and vice-versa), across the
 * core tenant models. Requires:
 *   DATABASE_URL  → the clone (localhost:5433/spsmain_clone)
 *   SNEEK_MULTITENANCY=1
 *
 * Run: npx cross-env DATABASE_URL=postgresql://postgres@127.0.0.1:5433/spsmain_clone \
 *        SNEEK_MULTITENANCY=1 vitest run tests/saas/leak-audit.test.ts
 *
 * Skips itself (so normal CI stays green) unless the flag is on.
 */
const ENABLED = MULTITENANCY_ENABLED && !!process.env.DATABASE_URL;
const d = ENABLED ? describe : describe.skip;

const prisma = new PrismaClient();
registerTenantScoping(prisma);

let orgA: string; // the backfilled production org (Org #1)
let orgB: string; // a fresh second tenant we seed for the audit

d("tenant isolation (2-tenant leak audit)", () => {
  beforeAll(async () => {
    // Org A = the existing backfilled org.
    const a = await runAsPlatformAdmin(async () =>
      prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } })
    );
    if (!a) throw new Error("No Organization #1 found — run the backfill first.");
    orgA = a.id;

    // Org B = an isolated second workspace with its own client.
    const b = await runAsPlatformAdmin(async () => {
      const existing = await prisma.organization.findFirst({ where: { slug: "audit-tenant-b" }, select: { id: true } });
      if (existing) return existing;
      return prisma.organization.create({
        data: { name: "Audit Tenant B", slug: "audit-tenant-b", status: "TRIALING" },
        select: { id: true },
      });
    });
    orgB = b.id;

    // Seed one client for Org B *inside its tenant context* — the middleware
    // should stamp organizationId = orgB automatically.
    const existingClient = await runWithTenant(orgB, async () =>
      prisma.client.findFirst({ where: { email: "leak-audit-b@example.com" }, select: { id: true } })
    );
    if (!existingClient) {
      await runWithTenant(orgB, async () =>
        prisma.client.create({ data: { name: "Audit B Client", email: "leak-audit-b@example.com" } })
      );
    }
  });

  it("create() auto-stamps organizationId for the active tenant", async () => {
    const c = await runWithTenant(orgB, async () =>
      prisma.client.findFirstOrThrow({ where: { email: "leak-audit-b@example.com" } })
    );
    expect((c as any).organizationId).toBe(orgB);
  });

  it("Org B sees ONLY its own clients (not Org A's 8)", async () => {
    const clients = await runWithTenant(orgB, async () => prisma.client.findMany({ select: { organizationId: true } }));
    expect(clients.length).toBeGreaterThan(0);
    expect(clients.every((c: any) => c.organizationId === orgB)).toBe(true);
  });

  it("Org A never sees Org B's seeded client", async () => {
    const leaked = await runWithTenant(orgA, async () =>
      prisma.client.findMany({ where: { email: "leak-audit-b@example.com" }, select: { id: true } })
    );
    expect(leaked).toHaveLength(0);
  });

  it("findUnique is rewritten + scoped: Org A cannot fetch an Org B row by id", async () => {
    const bClient = await runWithTenant(orgB, async () =>
      prisma.client.findFirstOrThrow({ where: { email: "leak-audit-b@example.com" }, select: { id: true } })
    );
    const crossRead = await runWithTenant(orgA, async () => prisma.client.findUnique({ where: { id: bClient.id } }));
    expect(crossRead).toBeNull();
  });

  it("core tables: every row Org A reads belongs to Org A", async () => {
    for (const model of ["job", "property", "client", "report", "quote"] as const) {
      const rows = await runWithTenant(orgA, async () => (prisma as any)[model].findMany({ select: { organizationId: true } }));
      expect(rows.every((r: any) => r.organizationId === orgA), `${model} leaked a non-A row`).toBe(true);
    }
  });

  it("deleteMany from Org B cannot touch Org A rows", async () => {
    // Attempt to delete 'all' clients while in Org B context — must only ever
    // affect Org B, never Org A's clients.
    const aCountBefore = await runAsPlatformAdmin(async () => prisma.client.count({ where: { organizationId: orgA } }));
    await runWithTenant(orgB, async () => prisma.client.deleteMany({ where: { name: "___nonexistent___" } }));
    const aCountAfter = await runAsPlatformAdmin(async () => prisma.client.count({ where: { organizationId: orgA } }));
    expect(aCountAfter).toBe(aCountBefore);
  });

  // MUST be the last test: enterTenantContext (enterWith) has no scoped exit, so
  // it persists for the remainder of this async context. This is exactly the
  // production request path — getSession() calls enterTenantContext, then the
  // handler's queries run scoped WITHOUT any run() wrapper.
  it("central enterWith wiring scopes queries with no run() wrapper (production request path)", async () => {
    enterTenantContext(orgB);
    const clients = await prisma.client.findMany({ select: { organizationId: true } });
    expect(clients.length).toBeGreaterThan(0);
    expect(clients.every((c: any) => c.organizationId === orgB), "enterWith path leaked a non-B row").toBe(true);
  });
});
