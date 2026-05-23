import { describe, it, expect } from "vitest";
import { saveDraft, getDraft, deleteDraft } from "@/lib/uploads/draft-store";

// jsdom has fake IndexedDB support via fake-indexeddb if installed; otherwise this test will skip cleanly
describe.skipIf(typeof indexedDB === "undefined")("draft-store", () => {
  it("saves and retrieves a draft", async () => {
    const record = {
      id: "test-1",
      filename: "test.jpg",
      size: 100,
      mime: "image/jpeg",
      uploadedAt: Date.now(),
      blob: new Blob(["test"]),
      status: "pending" as const,
      attempts: 0,
    };
    await saveDraft(record);
    const retrieved = await getDraft("test-1");
    expect(retrieved?.id).toBe("test-1");
    await deleteDraft("test-1");
  });
});
