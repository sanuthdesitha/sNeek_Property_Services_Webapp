import { describe, it, expect } from "vitest";
import {
  resolveCredentialStatuses,
  credentialsNeedingAttention,
  describeCredential,
  CREDENTIAL_WARNING_DAYS,
} from "@/lib/workforce/credential-expiry";

// Midday Sydney, so nothing here is sitting on a timezone boundary by accident.
const NOW = new Date("2026-08-22T02:00:00.000Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

describe("resolveCredentialStatuses", () => {
  it("reports nothing when no dates are recorded", () => {
    // Most of the workforce has no visa to record. "No date" means nothing to
    // chase, not a problem to flag.
    expect(resolveCredentialStatuses({}, NOW)).toEqual([]);
    expect(resolveCredentialStatuses({ visaExpiry: null }, NOW)).toEqual([]);
  });

  it("gives a visa a longer runway than a licence", () => {
    // Renewing a visa can mean an application and a wait; a rego renewal is a
    // form and a payment.
    expect(CREDENTIAL_WARNING_DAYS.VISA).toBeGreaterThan(CREDENTIAL_WARNING_DAYS.DRIVER_LICENCE);

    const at45 = { visaExpiry: inDays(45), driverLicenseExpiry: inDays(45) };
    const [visa, licence] = resolveCredentialStatuses(at45, NOW);
    expect(visa.kind).toBe("VISA");
    expect(visa.state).toBe("EXPIRING_SOON");
    expect(licence.state).toBe("OK");
  });

  it("orders by what lapses soonest", () => {
    const out = resolveCredentialStatuses(
      { visaExpiry: inDays(50), driverLicenseExpiry: inDays(2), vehicleRegoExpiry: inDays(20) },
      NOW
    );
    expect(out.map((c) => c.kind)).toEqual(["DRIVER_LICENCE", "VEHICLE_REGO", "VISA"]);
  });

  it("counts a credential expiring today as zero days, not minus one", () => {
    // It should read as 0 all day rather than flipping negative at some hour
    // because the stored time was midnight UTC.
    const [status] = resolveCredentialStatuses({ visaExpiry: NOW }, NOW);
    expect(status.daysRemaining).toBe(0);
    expect(status.state).toBe("EXPIRING_SOON");
  });

  it("marks a lapsed credential expired", () => {
    const [status] = resolveCredentialStatuses({ visaExpiry: inDays(-3) }, NOW);
    expect(status.state).toBe("EXPIRED");
    expect(status.daysRemaining).toBeLessThan(0);
  });

  it("ignores an unreadable date rather than throwing", () => {
    expect(
      resolveCredentialStatuses({ visaExpiry: new Date("nonsense") }, NOW)
    ).toEqual([]);
  });
});

describe("credentialsNeedingAttention", () => {
  it("returns only what someone has to act on", () => {
    const out = credentialsNeedingAttention(
      { visaExpiry: inDays(10), driverLicenseExpiry: inDays(900) },
      NOW
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("VISA");
  });

  it("is quiet when everything is current", () => {
    expect(
      credentialsNeedingAttention({ visaExpiry: inDays(400), vehicleRegoExpiry: inDays(200) }, NOW)
    ).toEqual([]);
  });
});

describe("describeCredential", () => {
  it("names the person and the credential, not just 'expiring'", () => {
    // A subject line saying only "credential expiring" makes every recipient
    // open it to find out whether it concerns them.
    const [status] = resolveCredentialStatuses({ visaExpiry: inDays(12) }, NOW);
    const line = describeCredential(status, "Ana");
    expect(line).toContain("Ana");
    expect(line).toMatch(/Visa/i);
    expect(line).toContain("12 days");
  });

  it("says TODAY rather than 'in 0 days'", () => {
    const [status] = resolveCredentialStatuses({ visaExpiry: NOW }, NOW);
    expect(describeCredential(status, "Ana")).toMatch(/TODAY/);
  });

  it("says how long ago something lapsed", () => {
    const [status] = resolveCredentialStatuses({ driverLicenseExpiry: inDays(-1) }, NOW);
    expect(describeCredential(status, "Ana")).toMatch(/EXPIRED 1 day ago/);
  });
});
