import { describe, expect, it } from "vitest";
import { buildComingUp, type ComingUpInput, type ComingUpJob, type ComingUpReservation } from "@/lib/properties/coming-up";
import { documentsAndDetails } from "@/lib/properties/documents";

const day = (key: string) => new Date(`${key}T00:00:00Z`);

function reservation(id: string, start: string, end: string, guestName: string | null = id): ComingUpReservation {
  return { id, startDate: day(start), endDate: day(end), guestName, checkinAtLocal: null, checkoutAtLocal: null };
}

function job(partial: Partial<ComingUpJob> & { id: string; date: string }): ComingUpJob {
  return {
    id: partial.id,
    jobNumber: partial.jobNumber ?? `J-${partial.id}`,
    scheduledDate: day(partial.date),
    startTime: partial.startTime ?? "10:00",
    status: partial.status ?? "ASSIGNED",
    reservationId: partial.reservationId ?? null,
    cleaners: partial.cleaners ?? [],
    laundry: partial.laundry ?? null,
  };
}

function input(partial: Partial<ComingUpInput>): ComingUpInput {
  return {
    todayKey: "2026-11-12",
    windowDays: 21,
    maxRows: 8,
    timeZone: "Australia/Sydney",
    defaultCheckinTime: "15:00",
    defaultCheckoutTime: "10:00",
    laundryEnabled: true,
    syncCreatesJobs: true,
    reservations: [],
    jobs: [],
    ...partial,
  };
}

describe("coming up read model", () => {
  it("joins the leaving guest, the arriving guest, the job, cleaners and laundry for one day", () => {
    const rows = buildComingUp(input({
      reservations: [reservation("liam", "2026-11-08", "2026-11-12"), reservation("sofia", "2026-11-12", "2026-11-16")],
      jobs: [job({ id: "1", date: "2026-11-12", reservationId: "liam", cleaners: ["Maria L."], laundry: { status: "PENDING", pickupDate: day("2026-11-12"), pickupTime: "14:30", noPickupRequired: false } })],
    }));
    expect(rows[0]).toMatchObject({
      dayKey: "2026-11-12",
      guestOut: { name: "liam", time: "10:00" },
      guestIn: { name: "sofia", time: "15:00" },
      sameDay: true,
      job: { id: "1", jobNumber: "J-1" },
      cleaners: ["Maria L."],
      laundry: { kind: "pickup", time: "14:30", sameDay: true },
    });
  });

  it("states a missing next booking and an unassigned job instead of filling them", () => {
    const rows = buildComingUp(input({
      reservations: [reservation("ken", "2026-11-16", "2026-11-20")],
      jobs: [job({ id: "2", date: "2026-11-20", status: "UNASSIGNED", reservationId: "ken" })],
    }));
    expect(rows[0]).toMatchObject({ guestIn: null, sameDay: false, cleaners: [], job: { status: "UNASSIGNED" } });
  });

  it("a checkout without a job says whether the next sync creates one", () => {
    const reservations = [reservation("hannah", "2026-11-25", "2026-11-28")];
    expect(buildComingUp(input({ reservations }))[0]).toMatchObject({ job: null, missingJob: "created-at-next-sync" });
    expect(buildComingUp(input({ reservations, syncCreatesJobs: false }))[0]).toMatchObject({ job: null, missingJob: "no-job" });
  });

  it("says when the property has no laundry service and when a run was delivered", () => {
    const off = buildComingUp(input({ laundryEnabled: false, jobs: [job({ id: "3", date: "2026-11-13" })] }));
    expect(off[0].laundry).toEqual({ kind: "off" });
    const dropped = buildComingUp(input({ jobs: [job({ id: "4", date: "2026-11-13", laundry: { status: "DROPPED", pickupDate: day("2026-11-13"), pickupTime: null, noPickupRequired: false } })] }));
    expect(dropped[0].laundry).toEqual({ kind: "status", label: "Delivered" });
  });

  it("keeps to the window, sorts by day and time, and caps the rows", () => {
    const rows = buildComingUp(input({
      maxRows: 2,
      jobs: [job({ id: "late", date: "2026-11-14", startTime: "13:00" }), job({ id: "early", date: "2026-11-14", startTime: "09:00" }), job({ id: "past", date: "2026-11-11" }), job({ id: "far", date: "2026-12-30" }), job({ id: "next", date: "2026-11-15" })],
    }));
    expect(rows.map((r) => r.job?.id)).toEqual(["early", "late"]);
  });

  it("names a guest the feed gave no name for as unknown, not as someone", () => {
    const rows = buildComingUp(input({ reservations: [reservation("x", "2026-11-10", "2026-11-13", null)] }));
    expect(rows[0].guestOut?.name).toBeNull();
  });
});

describe("documents and additional details", () => {
  it("lists access files and uploaded intake answers, and labels the other intake answers", () => {
    const result = documentsAndDetails(
      { attachments: [{ name: "Strata by-laws.pdf", url: "https://files.invalid/a.pdf" }, { url: "" }] },
      { f1: { url: "https://files.invalid/induction%20pack.pdf", key: "k" }, f2: "Yes please", f3: true, f4: "" },
      [
        { id: "f1", label: "Building induction", type: "file" },
        { id: "f2", label: "Pets", type: "text" },
        { id: "f3", label: "Has lift", type: "yesno" },
        { id: "f4", label: "Empty", type: "text" },
      ],
    );
    expect(result.documents).toEqual([
      { label: "Access", name: "Strata by-laws.pdf", url: "https://files.invalid/a.pdf", source: "access" },
      { label: "Building induction", name: "induction pack.pdf", url: "https://files.invalid/induction%20pack.pdf", source: "intake" },
    ]);
    expect(result.details).toEqual([{ label: "Pets", value: "Yes please" }, { label: "Has lift", value: "Yes" }]);
  });

  it("is empty for a property with nothing captured", () => {
    expect(documentsAndDetails(null, null, [])).toEqual({ documents: [], details: [] });
  });
});
