import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    client: {
      findUnique: vi.fn().mockResolvedValue({
        id: "c1",
        name: "Alice Smith",
        suburb: "Surry Hills",
      }),
    },
    job: {
      findUnique: vi.fn().mockResolvedValue({
        id: "j1",
        scheduledDate: new Date("2026-06-01T09:30:00Z"),
        property: { name: "Surry Hills loft" },
      }),
    },
    property: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ name: "Surry Hills loft", suburb: "Surry Hills" }),
    },
    quote: {
      findUnique: vi.fn().mockResolvedValue({ totalAmount: 250.5 }),
    },
    user: { findUnique: vi.fn() },
  },
}));

import { resolveTemplate, extractVariablePaths } from "@/lib/messages/variables";

describe("resolveTemplate", () => {
  it("replaces simple variables", async () => {
    const out = await resolveTemplate("Hi {{client.firstName}}!", {
      client: { id: "c1" },
    });
    expect(out).toBe("Hi Alice!");
  });

  it("derives lastName from client.name", async () => {
    const out = await resolveTemplate("Hello {{client.lastName}}", {
      client: { id: "c1" },
    });
    expect(out).toBe("Hello Smith");
  });

  it("applies currency filter", async () => {
    const out = await resolveTemplate(
      "Total: {{quote.totalAmount | currency}}",
      { quote: { id: "q1" } },
    );
    expect(out).toBe("Total: $250.50");
  });

  it("applies date short filter on scheduledFor alias", async () => {
    const out = await resolveTemplate("Booked: {{job.scheduledFor | date short}}", {
      job: { id: "j1" },
    });
    // Format: EEE d MMM (e.g., "Mon 1 Jun")
    expect(out).toMatch(/Booked: \w{3} \d{1,2} \w{3}/);
  });

  it("applies upper filter", async () => {
    const out = await resolveTemplate("Hi {{client.firstName | upper}}", {
      client: { id: "c1" },
    });
    expect(out).toBe("Hi ALICE");
  });

  it("leaves missing variables empty", async () => {
    const out = await resolveTemplate(
      "Hello {{client.middleName}}!",
      { client: { id: "c1" } },
    );
    expect(out).toBe("Hello !");
  });

  it("returns empty for unloaded context", async () => {
    const out = await resolveTemplate("Hi {{client.firstName}}", {});
    expect(out).toBe("Hi ");
  });

  it("extracts variable paths", () => {
    const paths = extractVariablePaths(
      "Hi {{client.firstName}}, your job at {{property.name}} on {{job.scheduledFor | date short}}",
    );
    expect(paths).toEqual([
      "client.firstName",
      "property.name",
      "job.scheduledFor",
    ]);
  });
});
