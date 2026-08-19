import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    quoteLead: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    job: { findMany: vi.fn(), create: vi.fn() },
    property: { findUnique: vi.fn(), findMany: vi.fn() },
    client: { findUnique: vi.fn() },
    user: { count: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/jobs/job-number", () => ({
  reserveJobNumber: vi.fn(async () => "J-1001"),
}));

import {
  BOOKING_REQUEST_VIA,
  BookingRequestError,
  approveBookingRequest,
  declineBookingRequest,
  getTeamAvailability,
  listPendingBookingRequests,
} from "@/lib/booking/requests";

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.$transaction.mockImplementation(async (fn: any) => fn(dbMock));
  dbMock.auditLog.create.mockResolvedValue({});
  dbMock.quoteLead.update.mockResolvedValue({});
});

const CTX = {
  createdVia: BOOKING_REQUEST_VIA,
  propertyId: "prop-1",
  jobType: "GENERAL_CLEAN",
  scheduledDate: "2026-09-03",
};

/**
 * A booking that becomes a job before anyone agrees to it is the bug. These
 * cover the two ways that goes wrong: work appearing unbidden, and one request
 * becoming two jobs.
 */
describe("approveBookingRequest", () => {
  it("creates the job only on approval, on the requested Sydney day", async () => {
    dbMock.quoteLead.findUnique.mockResolvedValue({
      id: "lead-1",
      status: "NEW",
      notes: "Back door key",
      structuredContext: CTX,
    });
    dbMock.property.findUnique.mockResolvedValue({ id: "prop-1" });
    dbMock.quoteLead.updateMany.mockResolvedValue({ count: 1 });
    dbMock.job.create.mockResolvedValue({ id: "job-1", jobNumber: "J-1001" });

    const result = await approveBookingRequest({ requestId: "lead-1", adminUserId: "admin-1" });

    expect(result).toMatchObject({ jobId: "job-1", jobNumber: "J-1001" });
    const created = dbMock.job.create.mock.calls[0][0].data;
    expect(created.propertyId).toBe("prop-1");
    expect(created.status).toBe("UNASSIGNED");
    expect(created.notes).toBe("Back door key");
    // 3 Sep 2026 00:00 Sydney (AEST, UTC+10) is 2 Sep 14:00 UTC.
    expect(created.scheduledDate.toISOString()).toBe("2026-09-02T14:00:00.000Z");
  });

  it("claims the request BEFORE creating the job, so a double click cannot make two", async () => {
    dbMock.quoteLead.findUnique.mockResolvedValue({
      id: "lead-1",
      status: "NEW",
      notes: null,
      structuredContext: CTX,
    });
    dbMock.property.findUnique.mockResolvedValue({ id: "prop-1" });
    // The second admin's guarded update matches no row.
    dbMock.quoteLead.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      approveBookingRequest({ requestId: "lead-1", adminUserId: "admin-2" })
    ).rejects.toThrow(/already been decided/i);
    expect(dbMock.job.create).not.toHaveBeenCalled();
  });

  it("honours an admin moving the date off the one the client asked for", async () => {
    dbMock.quoteLead.findUnique.mockResolvedValue({
      id: "lead-1",
      status: "NEW",
      notes: null,
      structuredContext: CTX,
    });
    dbMock.property.findUnique.mockResolvedValue({ id: "prop-1" });
    dbMock.quoteLead.updateMany.mockResolvedValue({ count: 1 });
    dbMock.job.create.mockResolvedValue({ id: "job-2", jobNumber: "J-1002" });

    const result = await approveBookingRequest({
      requestId: "lead-1",
      adminUserId: "admin-1",
      scheduledDate: "2026-09-05",
    });

    expect(result.scheduledDate).toBe("2026-09-05");
    // The move is recorded, because the client will notice it.
    const audit = dbMock.auditLog.create.mock.calls[0][0].data.after;
    expect(audit.movedFromRequestedDate).toBe(true);
  });

  it("refuses a lead that is not a client booking", async () => {
    dbMock.quoteLead.findUnique.mockResolvedValue({
      id: "lead-9",
      status: "NEW",
      notes: null,
      structuredContext: { createdVia: "website_quote" },
    });

    await expect(
      approveBookingRequest({ requestId: "lead-9", adminUserId: "admin-1" })
    ).rejects.toThrow(BookingRequestError);
    expect(dbMock.job.create).not.toHaveBeenCalled();
  });

  it("refuses when the property has since been deleted", async () => {
    dbMock.quoteLead.findUnique.mockResolvedValue({
      id: "lead-1",
      status: "NEW",
      notes: null,
      structuredContext: CTX,
    });
    dbMock.property.findUnique.mockResolvedValue(null);

    await expect(
      approveBookingRequest({ requestId: "lead-1", adminUserId: "admin-1" })
    ).rejects.toThrow(/property/i);
    expect(dbMock.quoteLead.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a request already approved", async () => {
    dbMock.quoteLead.findUnique.mockResolvedValue({
      id: "lead-1",
      status: "CONVERTED",
      notes: null,
      structuredContext: CTX,
    });

    await expect(
      approveBookingRequest({ requestId: "lead-1", adminUserId: "admin-1" })
    ).rejects.toThrow(/already been decided/i);
  });
});

describe("declineBookingRequest", () => {
  it("marks the lead LOST, keeps the reason, and creates no job", async () => {
    dbMock.quoteLead.findUnique.mockResolvedValue({
      id: "lead-1",
      status: "NEW",
      structuredContext: CTX,
    });
    dbMock.quoteLead.updateMany.mockResolvedValue({ count: 1 });

    await declineBookingRequest({
      requestId: "lead-1",
      adminUserId: "admin-1",
      reason: "Fully booked that weekend",
    });

    const data = dbMock.quoteLead.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe("LOST");
    expect(data.structuredContext.declineReason).toBe("Fully booked that weekend");
    expect(dbMock.job.create).not.toHaveBeenCalled();
  });

  it("refuses one already decided", async () => {
    dbMock.quoteLead.findUnique.mockResolvedValue({
      id: "lead-1",
      status: "LOST",
      structuredContext: CTX,
    });

    await expect(
      declineBookingRequest({ requestId: "lead-1", adminUserId: "admin-1" })
    ).rejects.toThrow(/already been decided/i);
  });
});

/**
 * The availability figure is the reason approval exists at all — if it is
 * wrong, an admin approves into a day with nobody on it.
 */
describe("getTeamAvailability", () => {
  it("counts a cleaner with three jobs as ONE unavailable person", async () => {
    dbMock.user.count.mockResolvedValue(4);
    dbMock.job.findMany.mockResolvedValue([
      { status: "ASSIGNED", assignments: [{ userId: "c1" }] },
      { status: "ASSIGNED", assignments: [{ userId: "c1" }] },
      { status: "IN_PROGRESS", assignments: [{ userId: "c1" }] },
    ]);

    const a = await getTeamAvailability("2026-09-03");
    expect(a.busyCleaners).toBe(1);
    expect(a.freeCleaners).toBe(3);
    expect(a.jobsScheduled).toBe(3);
  });

  it("counts a job with nobody on it as unassigned, not as a busy cleaner", async () => {
    dbMock.user.count.mockResolvedValue(2);
    dbMock.job.findMany.mockResolvedValue([
      { status: "UNASSIGNED", assignments: [] },
      { status: "ASSIGNED", assignments: [{ userId: "c1" }] },
    ]);

    const a = await getTeamAvailability("2026-09-03");
    expect(a.unassignedJobs).toBe(1);
    expect(a.busyCleaners).toBe(1);
    expect(a.freeCleaners).toBe(1);
  });

  it("never reports negative headroom", async () => {
    dbMock.user.count.mockResolvedValue(1);
    dbMock.job.findMany.mockResolvedValue([
      { status: "ASSIGNED", assignments: [{ userId: "c1" }, { userId: "c2" }] },
    ]);

    const a = await getTeamAvailability("2026-09-03");
    expect(a.freeCleaners).toBe(0);
  });

  it("asks for the Sydney day, not the UTC one", async () => {
    dbMock.user.count.mockResolvedValue(1);
    dbMock.job.findMany.mockResolvedValue([]);

    await getTeamAvailability("2026-09-03");
    const where = dbMock.job.findMany.mock.calls[0][0].where;
    expect(where.scheduledDate.gte.toISOString()).toBe("2026-09-02T14:00:00.000Z");
    expect(where.scheduledDate.lte.toISOString()).toBe("2026-09-03T13:59:59.999Z");
  });
});

describe("listPendingBookingRequests", () => {
  it("returns only client bookings, ignoring ordinary sales leads", async () => {
    dbMock.quoteLead.findMany.mockResolvedValue([
      {
        id: "lead-1",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        clientId: "client-1",
        name: "Fallback Name",
        email: "a@example.com",
        notes: null,
        estimateMin: 220,
        structuredContext: CTX,
        client: { name: "Harbour Stays" },
      },
      {
        id: "lead-2",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        clientId: null,
        name: "Website Enquiry",
        email: "b@example.com",
        notes: null,
        estimateMin: null,
        structuredContext: { createdVia: "website_quote" },
        client: null,
      },
    ]);
    dbMock.property.findMany.mockResolvedValue([
      { id: "prop-1", name: "Bondi Loft", address: "1 Beach Rd", suburb: "Bondi" },
    ]);

    const rows = await listPendingBookingRequests();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("lead-1");
    // The client's real name wins over the name copied onto the lead.
    expect(rows[0].clientName).toBe("Harbour Stays");
    expect(rows[0].property?.name).toBe("Bondi Loft");
    expect(rows[0].scheduledDate).toBe("2026-09-03");
  });

  it("survives a request whose property has been deleted", async () => {
    dbMock.quoteLead.findMany.mockResolvedValue([
      {
        id: "lead-1",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        clientId: "client-1",
        name: "Client",
        email: "a@example.com",
        notes: null,
        estimateMin: null,
        structuredContext: CTX,
        client: null,
      },
    ]);
    dbMock.property.findMany.mockResolvedValue([]);

    const rows = await listPendingBookingRequests();
    expect(rows[0].property).toBeNull();
  });

  it("does not query properties at all when nothing is pending", async () => {
    dbMock.quoteLead.findMany.mockResolvedValue([]);
    const rows = await listPendingBookingRequests();
    expect(rows).toEqual([]);
    expect(dbMock.property.findMany).not.toHaveBeenCalled();
  });
});

/**
 * The decision notice is what finally closes the loop with the client. The
 * old flow told them nothing; a queue that also tells them nothing would be
 * the same silence with an extra step.
 */
describe("decision notice", () => {
  function pendingLead(over: Record<string, unknown> = {}) {
    return {
      id: "lead-1",
      status: "NEW",
      notes: null,
      structuredContext: CTX,
      name: "Lead Snapshot Name",
      email: "stale@example.test",
      clientId: "client-1",
      ...over,
    };
  }

  it("prefers the client record over the snapshot copied onto the lead", async () => {
    dbMock.quoteLead.findUnique.mockResolvedValue(pendingLead());
    dbMock.client.findUnique.mockResolvedValue({
      name: "Harbour Stays",
      email: "ops@harbour.test",
    });
    dbMock.property.findUnique.mockResolvedValue({ id: "prop-1", name: "Bondi Loft" });
    dbMock.quoteLead.updateMany.mockResolvedValue({ count: 1 });
    dbMock.job.create.mockResolvedValue({ id: "job-1", jobNumber: "J-1001" });

    const { notice } = await approveBookingRequest({ requestId: "lead-1", adminUserId: "a" });

    // The lead copy was taken when the booking was made and may be months old.
    expect(notice.email).toBe("ops@harbour.test");
    expect(notice.clientName).toBe("Harbour Stays");
    expect(notice.propertyName).toBe("Bondi Loft");
    expect(notice.requestedDate).toBe("2026-09-03");
  });

  it("falls back to the lead address when the client has none", async () => {
    dbMock.quoteLead.findUnique.mockResolvedValue(pendingLead());
    dbMock.client.findUnique.mockResolvedValue({ name: "Harbour Stays", email: "   " });
    dbMock.property.findUnique.mockResolvedValue({ id: "prop-1", name: "Bondi Loft" });
    dbMock.quoteLead.updateMany.mockResolvedValue({ count: 1 });
    dbMock.job.create.mockResolvedValue({ id: "job-1", jobNumber: "J-1001" });

    const { notice } = await approveBookingRequest({ requestId: "lead-1", adminUserId: "a" });
    expect(notice.email).toBe("stale@example.test");
  });

  it("reports no address rather than inventing one", async () => {
    dbMock.quoteLead.findUnique.mockResolvedValue(pendingLead({ clientId: null, email: "" }));
    dbMock.property.findUnique.mockResolvedValue({ id: "prop-1", name: "Bondi Loft" });
    dbMock.quoteLead.updateMany.mockResolvedValue({ count: 1 });
    dbMock.job.create.mockResolvedValue({ id: "job-1", jobNumber: "J-1001" });

    const { notice } = await approveBookingRequest({ requestId: "lead-1", adminUserId: "a" });
    expect(notice.email).toBeNull();
    // No clientId means no lookup at all.
    expect(dbMock.client.findUnique).not.toHaveBeenCalled();
  });

  it("comes back from a decline too, so the client can be told why", async () => {
    dbMock.quoteLead.findUnique.mockResolvedValue(pendingLead());
    dbMock.client.findUnique.mockResolvedValue({
      name: "Harbour Stays",
      email: "ops@harbour.test",
    });
    dbMock.property.findUnique.mockResolvedValue({ id: "prop-1", name: "Bondi Loft" });
    dbMock.quoteLead.updateMany.mockResolvedValue({ count: 1 });

    const { notice } = await declineBookingRequest({
      requestId: "lead-1",
      adminUserId: "a",
      reason: "Fully booked",
    });
    expect(notice.email).toBe("ops@harbour.test");
    expect(notice.jobType).toBe("GENERAL_CLEAN");
  });
});
