import { test, expect } from "@playwright/test";

// Deliberately anonymous and uses an impossible fixture id: this exercises the
// live auth boundary without touching a real cleaner's work or evidence.
test("anonymous callers cannot read or submit a cleaner form using a claimed revision", async ({ request }) => {
  const id = "e2e-anonymous-form-contract-no-job";
  const read = await request.get(`/api/jobs/${id}/form`, { maxRedirects: 0 });
  expect([401, 403, 307]).toContain(read.status());
  const submit = await request.post(`/api/cleaner/jobs/${id}/submit`, {
    maxRedirects: 0,
    data: { templateId: "untrusted", formContractVersion: 1, formRevision: "a".repeat(64), data: {} },
  });
  expect([401, 403, 307]).toContain(submit.status());
});
