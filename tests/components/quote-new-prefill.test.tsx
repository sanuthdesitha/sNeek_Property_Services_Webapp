/**
 * New quote prefills (2026-11): `?clientId=` (New quote from a client page) and
 * `?leadId=` (Make quote from the pipeline) preselect the recipient only when
 * the server finds the record; an unknown or inactive client is ignored with a
 * notice. `?fromCase=` keeps working and wins.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const m = vi.hoisted(() => ({ client: vi.fn(), lead: vi.fn(), builder: vi.fn(), casePrefill: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: vi.fn(async () => ({ user: { id: "a", role: "ADMIN" } })) }));
vi.mock("@/lib/db", () => ({
  db: {
    client: { findFirst: m.client, findMany: vi.fn(async () => []) },
    quoteLead: { findUnique: m.lead, findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn(async () => ({ pricing: { gstEnabled: true }, pricingVariables: [] })) }));
vi.mock("@/lib/cases/repair-quote", () => ({ loadCaseQuotePrefill: m.casePrefill }));
vi.mock("@/components/v2/admin/quotes/quote-builder", () => ({
  QuoteBuilder: (props: Record<string, unknown>) => {
    m.builder(props);
    return null;
  },
}));

import V2NewQuotePage from "@/app/v2/admin/quotes/new/page";

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("New quote prefill", () => {
  it("preselects an active client found on the server", async () => {
    m.client.mockResolvedValue({ id: "c1", name: "Coastal Retreats", email: "e@x", suburb: null });
    render(await V2NewQuotePage({ searchParams: { clientId: "c1" } }));
    const props = m.builder.mock.calls[0][0] as { recipientPrefill: { clientId?: string }; clients: Array<{ id: string }> };
    expect(m.client).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c1", isActive: true } }));
    expect(props.recipientPrefill.clientId).toBe("c1");
    expect(props.clients.some((client) => client.id === "c1")).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores an unknown client with a notice and preselects a lead", async () => {
    m.client.mockResolvedValue(null);
    m.lead.mockResolvedValue({ id: "l1", name: "Olivia", email: "o@x", suburb: null, serviceType: "AIRBNB_TURNOVER", bedrooms: null, bathrooms: null, estimateMin: null, estimateMax: null });
    render(await V2NewQuotePage({ searchParams: { clientId: "nope", leadId: "l1" } }));
    const props = m.builder.mock.calls[0][0] as { recipientPrefill: { clientId?: string; leadId?: string } };
    expect(props.recipientPrefill).toEqual({ clientId: undefined, leadId: "l1" });
    expect(screen.getByRole("alert").textContent).toMatch(/could not be found or is inactive/);
  });

  it("refuses malformed ids without a database read", async () => {
    render(await V2NewQuotePage({ searchParams: { clientId: "bad id;drop" } }));
    expect(m.client).not.toHaveBeenCalled();
  });
});
