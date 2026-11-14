// @vitest-environment node
/**
 * Delivery profiles (board "Delivery profiles", 2026-11-16): recipients and
 * the real fallback, results that never call a queued email delivered, the
 * stale-write guard, the auto-send switches that nothing reads, and the live
 * role guard on every route.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, requireRole } = vi.hoisted(() => ({
  store: { value: null as unknown },
  requireRole: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const appSetting = {
    findUnique: vi.fn(async () => (store.value ? { value: store.value } : null)),
    upsert: vi.fn(async ({ create, update }: { create: { value: unknown }; update: { value: unknown } }) => {
      store.value = store.value ? update.value : create.value;
      return {};
    }),
  };
  return {
    db: {
      appSetting,
      $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({ appSetting, $executeRaw: vi.fn(async () => 1) })),
      client: { findUnique: vi.fn(async () => ({ id: "c1" })) },
      auditLog: { create: vi.fn(async () => ({})) },
      user: { findUnique: vi.fn(async () => ({ name: "Hannah Lee", email: "hannah@example.com" })) },
    },
  };
});
vi.mock("@/lib/auth/session", () => ({ requireRole }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: vi.fn(async () => ({ communications: "view" })) }));

import {
  deliveryProblems,
  deliveryRoute,
  matchesFilter,
  routeAddresses,
  sendResultFor,
  SEND_RESULT_WORDS,
  deliveryCsv,
  type DeliveryOverviewRow,
} from "@/lib/commercial/delivery-model";
import { DeliveryProfileConflictError, upsertClientDeliveryProfile, resolveClientDeliveryRecipients } from "@/lib/commercial/delivery-profiles";

const noBounces = new Map();

beforeEach(() => {
  store.value = null;
  requireRole.mockReset();
});

describe("recipients and fallback", () => {
  it("an empty list shows the client email as the fallback, exactly what Send uses", async () => {
    const route = deliveryRoute([], "Accounts@Client.com", noBounces);
    expect(route.custom).toEqual([]);
    expect(route.fallback).toEqual([{ email: "accounts@client.com", source: "client_email", bounce: null }]);
    expect(await resolveClientDeliveryRecipients({ clientId: "c1", fallbackEmail: "Accounts@Client.com", kind: "invoice" })).toEqual(["Accounts@Client.com"]);
  });

  it("a list is used with the client email added once, duplicates removed", () => {
    const route = deliveryRoute(["olivia@x.com", "OLIVIA@x.com", "accounts@client.com"], "accounts@client.com", noBounces);
    expect(routeAddresses(route)).toEqual(["olivia@x.com", "accounts@client.com"]);
    expect(route.fallback).toEqual([]);
  });

  it("no address at all is an address problem, never 'nobody' silently", () => {
    const route = deliveryRoute([], null, noBounces);
    expect(routeAddresses(route)).toEqual([]);
    expect(deliveryProblems(route, route)).toEqual(["no_invoice_address", "no_report_address"]);
  });

  it("marks an address on the bounce list", () => {
    const bounces = new Map([["billing@iwss.com.au", { reason: "HARD_BOUNCE", since: "2026-11-10T00:00:00.000Z" }]]);
    const invoices = deliveryRoute(["billing@iwss.com.au"], null, bounces);
    expect(invoices.custom[0].bounce?.reason).toBe("HARD_BOUNCE");
    expect(deliveryProblems(deliveryRoute([], "a@b.co", bounces), invoices)).toContain("bounce");
  });
});

describe("results per address", () => {
  it("queued is never handed over or delivered", () => {
    expect(sendResultFor("ALLOWED", null)).toBe("queued");
    expect(sendResultFor("HELD", null)).toBe("queued");
    expect(sendResultFor("ALLOWED", "ACCEPTED")).toBe("handed_over");
    expect(sendResultFor("ALLOWED", "NOT_ACCEPTED")).toBe("failed");
    expect(sendResultFor("ALLOWED", "UNCERTAIN")).toBe("unknown");
    expect(sendResultFor("SUPPRESSED", null)).toBe("not_sent");
    expect(Object.values(SEND_RESULT_WORDS)).not.toContain("Delivered");
  });
});

describe("stale-write guard", () => {
  it("refuses a save over a newer profile and carries the current one", async () => {
    const first = await upsertClientDeliveryProfile({ clientId: "c1", reportRecipients: ["a@x.com"], updatedByUserId: "u1", expectedUpdatedAt: null });
    await expect(upsertClientDeliveryProfile({ clientId: "c1", reportRecipients: ["b@x.com"], updatedByUserId: "u2", expectedUpdatedAt: null })).rejects.toBeInstanceOf(DeliveryProfileConflictError);
    try {
      await upsertClientDeliveryProfile({ clientId: "c1", reportRecipients: ["b@x.com"], expectedUpdatedAt: "2020-01-01T00:00:00.000Z" });
    } catch (error) {
      expect((error as DeliveryProfileConflictError).current?.reportRecipients).toEqual(["a@x.com"]);
    }
    const second = await upsertClientDeliveryProfile({ clientId: "c1", reportRecipients: ["b@x.com"], updatedByUserId: "u2", expectedUpdatedAt: first.updatedAt });
    expect(second.reportRecipients).toEqual(["b@x.com"]);
  });

  it("keeps the stored auto-send values when only recipients are saved", async () => {
    store.value = { profiles: [{ clientId: "c1", reportRecipients: [], invoiceRecipients: [], autoSendReports: true, autoSendInvoices: true, updatedAt: "2026-03-03T00:00:00.000Z", updatedByUserId: null }] };
    const saved = await upsertClientDeliveryProfile({ clientId: "c1", invoiceRecipients: ["accounts@x.com"], expectedUpdatedAt: "2026-03-03T00:00:00.000Z" });
    expect(saved).toMatchObject({ autoSendReports: true, autoSendInvoices: true, invoiceRecipients: ["accounts@x.com"] });
  });

  it("the route answers 409 with who changed it", async () => {
    requireRole.mockResolvedValue({ user: { id: "u2", role: "ADMIN", heldRoles: ["ADMIN"] } });
    store.value = { profiles: [{ clientId: "c1", reportRecipients: ["a@x.com"], invoiceRecipients: [], autoSendReports: false, autoSendInvoices: false, updatedAt: "2026-11-16T00:12:00.000Z", updatedByUserId: "u1" }] };
    const { PATCH } = await import("@/app/api/admin/client-delivery-profiles/route");
    const response = await PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify({ clientId: "c1", reportRecipients: ["b@x.com"], expectedUpdatedAt: "2026-11-15T00:00:00.000Z" }) }) as never);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("STALE_WRITE");
    expect(body.current.updatedBy.name).toBe("Hannah Lee");
  });
});

describe("authorization", () => {
  it("every delivery profile route calls the live role guard and refuses others", async () => {
    requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    const overview = await import("@/app/api/admin/client-delivery-profiles/overview/route");
    const sends = await import("@/app/api/admin/client-delivery-profiles/[clientId]/sends/route");
    expect((await overview.GET()).status).toBe(403);
    expect((await sends.GET(new Request("http://x"), { params: { clientId: "c1" } })).status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
  });

  it("an operations manager with a view-only communications pack cannot save", async () => {
    requireRole.mockResolvedValue({ user: { id: "m1", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } });
    const { PATCH } = await import("@/app/api/admin/client-delivery-profiles/route");
    const response = await PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify({ clientId: "c1", reportRecipients: [] }) }) as never);
    expect(response.status).toBe(403);
  });
});

describe("auto-send is not wired up", () => {
  const ROOT = process.cwd();
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : files(path);
      return /\.(ts|tsx)$/.test(name) ? [relative(ROOT, path).split("\\").join("/")] : [];
    });
  }
  it("only the store, its route and the editing screens mention the switches; no send path reads them", () => {
    const readers = ["app", "lib", "workers", "components"].flatMap((dir) => files(join(ROOT, dir)))
      .filter((file) => /autoSend(Reports|Invoices)/.test(readFileSync(join(ROOT, file), "utf8")));
    const allowed = [
      "lib/commercial/delivery-profiles.ts",
      "lib/commercial/delivery-model.ts",
      "lib/commercial/delivery-overview.ts",
      "app/api/admin/client-delivery-profiles/route.ts",
      "components/v2/admin/delivery-profiles/delivery-profiles-screen.tsx",
      "components/v2/admin/delivery-profiles/estate-delivery-profiles.tsx",
      "components/inventory/delivery-profiles-workspace.tsx",
    ];
    expect(readers.filter((file) => !allowed.includes(file))).toEqual([]);
  });

  it("the CSV says a stored switch is not in use", () => {
    const row = {
      client: { id: "c1", name: "Harbour View Stays", email: null, propertyCount: 6, portalUsers: [] },
      profile: { reportRecipients: [], invoiceRecipients: [], autoSendReports: true, autoSendInvoices: false, updatedAt: null, updatedBy: null },
      reports: { custom: [], fallback: [] },
      invoices: { custom: [], fallback: [] },
      problems: [],
      lastSent: null,
    } satisfies DeliveryOverviewRow;
    expect(deliveryCsv([row])).toContain("stored on, not in use");
    expect(matchesFilter(row, "fallback")).toBe(true);
  });
});
