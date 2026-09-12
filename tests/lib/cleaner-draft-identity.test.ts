// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cleanerDraftIdentity } from "@/lib/cleaner/draft-identity";

describe("cleanerDraftIdentity", () => {
  it("hashes a versioned structured tuple with SHA-256", () => {
    const identity = cleanerDraftIdentity({ user: { id: "cleaner" } }, "job");
    expect(identity).toBe(createHash("sha256").update(JSON.stringify([
      "cleaner-draft-identity-v1", "cleaner", "cleaner", "job",
    ])).digest("hex"));
    expect(identity).toMatch(/^[a-f0-9]{64}$/);
    expect(cleanerDraftIdentity({ user: { id: "cleaner" }, impersonation: null }, "job")).toBe(identity);
  });
  it("binds actual actor, effective user and job independently", () => {
    const identity = cleanerDraftIdentity({ user: { id: "cleaner" }, impersonation: { actorId: "admin" } }, "job");
    for (const alternative of [
      cleanerDraftIdentity({ user: { id: "cleaner" } }, "job"),
      cleanerDraftIdentity({ user: { id: "cleaner" }, impersonation: { actorId: "other-admin" } }, "job"),
      cleanerDraftIdentity({ user: { id: "other-cleaner" }, impersonation: { actorId: "admin" } }, "job"),
      cleanerDraftIdentity({ user: { id: "cleaner" }, impersonation: { actorId: "admin" } }, "other-job"),
    ]) expect(alternative).not.toBe(identity);
  });
  it("does not conflate IDs containing delimiters", () => {
    expect(cleanerDraftIdentity({ user: { id: "b:c" }, impersonation: { actorId: "a" } }, "d"))
      .not.toBe(cleanerDraftIdentity({ user: { id: "c" }, impersonation: { actorId: "a:b" } }, "d"));
  });
});
