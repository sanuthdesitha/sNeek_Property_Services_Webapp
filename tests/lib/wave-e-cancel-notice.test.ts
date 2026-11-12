// @vitest-environment node
/** The cancel notice is an inbox notice only: phone and browser push switched off explicitly; email never asked for. */
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ send: vi.fn(), controls: vi.fn() }));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: m.send }));
vi.mock("@/lib/notifications/type-controls", () => ({ getNotificationTypeControls: m.controls, typeRespectsPreferences: () => false }));
import { sendJobCancelledNotice } from "@/lib/jobs/cancel-notice";
import { catalogEntry } from "@/lib/notifications/catalog";

beforeEach(() => {
  vi.clearAllMocks();
  m.controls.mockResolvedValue({ disabledTransports: {} });
  m.send.mockResolvedValue([
    { userId: "c1", name: "Jane", transport: "INBOX", path: "pipeline", state: "inbox_available" },
    { userId: "c1", name: "Jane", transport: "MOBILE_PUSH", path: "pipeline", state: "switched_off" },
    { userId: "c1", name: "Jane", transport: "WEB_PUSH", path: "direct", state: "switched_off" },
  ]);
});

it("queues an inbox notice through the pipeline with an explicit, staff-member scope", async () => {
  const outcomes = await sendJobCancelledNotice({
    job: { id: "j1", jobNumber: "J-1", propertyName: "Bondi Studio", dayLabel: "Thu 12 Nov" },
    reason: "Booking cancelled", actorId: "admin", cancelledAtIso: "2026-11-12T00:00:00.000Z",
    recipients: [{ id: "c1", role: "CLEANER", name: "Jane", email: "j@x" }],
  });
  const input = m.send.mock.calls[0][0];
  expect(input).toMatchObject({ typeKey: "job.cancelled", eventKey: "job.cancelled", scopeType: "STAFF_MEMBER", transports: ["PUSH"] });
  expect(input.disabledTransports).toEqual(expect.arrayContaining(["MOBILE_PUSH", "WEB_PUSH"]));
  expect(input.transports).not.toContain("EMAIL");
  expect(input.body).toContain("Booking cancelled");
  expect(outcomes).toEqual([{ userId: "c1", name: "Jane", state: "inbox_available" }]);
  expect(catalogEntry("job.cancelled")).toMatchObject({ path: "PIPELINE", defaultTransports: ["INBOX"], transports: ["INBOX"] });
});
