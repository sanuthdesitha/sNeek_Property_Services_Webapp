import { describe, it, expect } from "vitest";
import { canTransition, validNextStates } from "@/lib/cases/lifecycle-fsm";

describe("case lifecycle", () => {
  it("OPEN -> TRIAGE is valid", () => expect(canTransition("OPEN", "TRIAGE")).toBe(true));
  it("OPEN -> RESOLVED is invalid (must go through TRIAGE)", () =>
    expect(canTransition("OPEN", "RESOLVED")).toBe(false));
  it("TRIAGE -> ASSIGNED is valid", () =>
    expect(canTransition("TRIAGE", "ASSIGNED")).toBe(true));
  it("ASSIGNED -> IN_PROGRESS is valid", () =>
    expect(canTransition("ASSIGNED", "IN_PROGRESS")).toBe(true));
  it("IN_PROGRESS -> RESOLVED is valid", () =>
    expect(canTransition("IN_PROGRESS", "RESOLVED")).toBe(true));
  it("RESOLVED -> CLOSED is valid", () =>
    expect(canTransition("RESOLVED", "CLOSED")).toBe(true));
  it("CLOSED -> anything is invalid", () =>
    expect(canTransition("CLOSED", "OPEN")).toBe(false));
  it("CANCELLED is terminal", () =>
    expect(canTransition("CANCELLED", "OPEN")).toBe(false));
  it("validNextStates(OPEN) lists TRIAGE and CANCELLED", () => {
    const next = validNextStates("OPEN");
    expect(next).toContain("TRIAGE");
    expect(next).toContain("CANCELLED");
  });
});
