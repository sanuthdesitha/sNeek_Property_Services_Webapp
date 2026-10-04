import { afterEach, describe, expect, it } from "vitest";
import { formatServiceDate } from "@/lib/time/service-date";
const original = process.env.TZ;
afterEach(()=>{ if(original===undefined) delete process.env.TZ; else process.env.TZ=original; });
describe("consistent service dates",()=>{
  it.each(["UTC","America/Los_Angeles","Australia/Sydney"])("uses Sydney regardless of host timezone %s",zone=>{
    process.env.TZ=zone;
    expect(formatServiceDate("2026-10-03T14:00:00Z")).toBe("04/10/2026");
    expect(formatServiceDate("2026-09-17T14:00:00Z")).toBe("18/09/2026");
    expect(formatServiceDate("2026-10-04T00:00:00Z")).toBe("04/10/2026");
    expect(formatServiceDate(new Date("2026-04-04T16:00:00Z"),"d MMM yyyy")).toBe("5 Apr 2026");
  });
  it("handles absent and invalid values without a broken page",()=>{
    expect(formatServiceDate(null)).toBe("—");
    expect(formatServiceDate(undefined)).toBe("—");
    expect(formatServiceDate("bad","d MMM","Date not set")).toBe("Date not set");
  });
});
