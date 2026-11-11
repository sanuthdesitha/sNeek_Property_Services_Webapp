import { describe, expect, it } from "vitest";
import {
  projectClientJobList,
  projectClientLaundryList,
  projectClientReportList,
  type ClientListVisibility,
} from "@/lib/client/list-projection";

const ALL: ClientListVisibility = {
  showCleanerNames: true,
  showLaundryUpdates: true,
  showLaundryCosts: true,
  showLaundryImages: true,
  showReportDownloads: true,
};

const confirmation = {
  id: "c1",
  photoUrl: "https://files.example/bag.jpg",
  notes: '{"totalPrice":42,"bagCount":3}',
  meta: { totalPrice: 42, supplierId: "s1", receiptImageKey: "r", dropoffPhotoKey: "p", bagCount: 3 },
};
const job = {
  id: "j1",
  assignments: [{ user: { id: "u1", name: "Sam" } }],
  laundryTask: { id: "l1", adminOverrideNote: "Pickup moved", confirmations: [confirmation] },
};

describe("client list projections", () => {
  it("returns rows unchanged when everything is switched on", () => {
    expect(projectClientJobList([job], ALL)).toEqual([job]);
    expect(projectClientReportList([{ id: "r1", pdfUrl: "x.pdf" }], ALL)).toEqual([{ id: "r1", pdfUrl: "x.pdf" }]);
  });

  it("hides cleaner names in the job list", () => {
    const [row] = projectClientJobList([job], { ...ALL, showCleanerNames: false });
    expect(row.assignments).toEqual([]);
    expect(row.laundryTask).not.toBeNull();
  });

  it("drops laundry from the job list and empties the laundry list when updates are off", () => {
    const off = { ...ALL, showLaundryUpdates: false };
    expect(projectClientJobList([job], off)[0].laundryTask).toBeNull();
    expect(projectClientLaundryList([job.laundryTask], off)).toEqual([]);
  });

  it("removes amounts but keeps counts when laundry costs are off", () => {
    const [task] = projectClientLaundryList([job.laundryTask], { ...ALL, showLaundryCosts: false });
    expect(task.confirmations[0].notes).toBeNull();
    expect(task.confirmations[0].meta).toEqual({ dropoffPhotoKey: "p", bagCount: 3 });
    expect(task.adminOverrideNote).toBe("Pickup moved");
  });

  it("removes photos when laundry images are off", () => {
    const [task] = projectClientLaundryList([job.laundryTask], { ...ALL, showLaundryImages: false });
    expect(task.confirmations[0].photoUrl).toBeNull();
    expect(task.confirmations[0].meta).toEqual({ totalPrice: 42, supplierId: "s1", bagCount: 3 });
  });

  it("keeps a report but removes its download link when downloads are off", () => {
    expect(projectClientReportList([{ id: "r1", pdfUrl: "x.pdf" }], { ...ALL, showReportDownloads: false })).toEqual([
      { id: "r1", pdfUrl: null },
    ]);
  });
});
