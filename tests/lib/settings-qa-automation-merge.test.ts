// @vitest-environment node
/**
 * Regression: saving the Safeguards screen sends only the five QA automation
 * fields it edits; the save must keep assignedOnly and createIssueTicket
 * (they used to reset to their defaults because the whole group was replaced).
 */
import { expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ stored: null as any, written: null as any }));
vi.mock("@/lib/db", () => {
  const tx = {
    $executeRaw: async () => 0,
    appSetting: {
      findUnique: async () => (m.stored ? { value: m.stored } : null),
      upsert: async ({ update }: any) => { m.written = update.value; return update; },
    },
  };
  return { db: { ...tx, $transaction: async (work: (client: unknown) => unknown) => work(tx) } };
});

import { DEFAULT_SETTINGS, saveAppSettings } from "@/lib/settings";

it("merges the Safeguards QA fields and keeps the others", async () => {
  m.stored = { ...DEFAULT_SETTINGS, qaAutomation: { ...DEFAULT_SETTINGS.qaAutomation, assignedOnly: false, createIssueTicket: false } };
  const saved = await saveAppSettings({ qaAutomation: { autoCreateReworkJob: true, failureThreshold: 80, reworkDelayHours: 24, autoScoreEnabled: true, autoScoreAfterHours: 24 } as any });
  expect(saved.qaAutomation.assignedOnly).toBe(false);
  expect(saved.qaAutomation.createIssueTicket).toBe(false);
  expect(m.written.qaAutomation).toMatchObject({ assignedOnly: false, createIssueTicket: false });
});
