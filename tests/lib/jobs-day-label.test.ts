import { describe, expect, it } from "vitest";
import { jobsDayGroupLabel } from "@/lib/jobs/list-day-label";
import { JOB_STATUS_TONES } from "@/lib/jobs/status-presentation";
import { jobsPillTone } from "@/components/v2/admin/jobs/job-row";

// Wednesday 11 November 2026, 09:00 in Sydney.
const NOW = new Date("2026-11-10T22:00:00.000Z");

describe("Jobs day group rows", () => {
  it('read "Thursday 12 November" with no Today/Tomorrow prefix', () => {
    expect(jobsDayGroupLabel("2026-11-12", NOW)).toEqual({ text: "Thursday 12 November", isToday: false });
    expect(jobsDayGroupLabel("2026-11-13", NOW)).toEqual({ text: "Friday 13 November", isToday: false });
  });

  it("flag today by the Sydney day, not the UTC day", () => {
    expect(jobsDayGroupLabel("2026-11-11", NOW)).toEqual({ text: "Wednesday 11 November", isToday: true });
    // 23:30 Sydney on the 11th is still the 11th even though UTC says the 11th 12:30.
    expect(jobsDayGroupLabel("2026-11-11", new Date("2026-11-11T12:30:00.000Z")).isToday).toBe(true);
    expect(jobsDayGroupLabel("2026-11-11", new Date("2026-11-11T13:30:00.000Z")).isToday).toBe(false);
  });

  it("keeps calendar dates unshifted across daylight saving", () => {
    expect(jobsDayGroupLabel("2026-04-05", NOW).text).toBe("Sunday 5 April");
    expect(jobsDayGroupLabel("2026-10-04", NOW).text).toBe("Sunday 4 October");
    expect(jobsDayGroupLabel("not-a-day", NOW)).toEqual({ text: "No date", isToday: false });
  });
});

describe("Unassigned pill on the Jobs surfaces", () => {
  it("uses the danger tone as drawn without changing the shared status tones", () => {
    expect(jobsPillTone("UNASSIGNED")).toBe("bad");
    expect(JOB_STATUS_TONES.UNASSIGNED).toBe("warning");
    expect(jobsPillTone("OFFERED")).not.toBe("bad");
  });
});
