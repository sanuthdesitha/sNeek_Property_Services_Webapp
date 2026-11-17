import { expect, it } from "vitest";
import { describeUploadContext } from "@/lib/uploads/failure-context";

it("summarises a failed video's diagnostics in plain words for the office", () => {
  expect(describeUploadContext({
    kind: "video", encoding: "original_unsupported", speedKbps: 180, partsDone: 3, partsTotal: 41,
    failure: "stalled", route: "direct", stalls: 5, lastStatus: null, effectiveType: "3g", online: true,
  })).toBe("180 kbps measured · parts 3/41 · stalled · 5 stalls · direct to storage · network 3g · original unsupported");
  expect(describeUploadContext({ kind: "video", failure: "refused", lastStatus: 403, route: "proxy", online: false }))
    .toBe("refused · HTTP 403 · via app server · offline");
});

it("ignores rows without video diagnostics", () => {
  expect(describeUploadContext(null)).toBeNull();
  expect(describeUploadContext([1])).toBeNull();
  expect(describeUploadContext({ retry: 2 })).toBeNull();
  expect(describeUploadContext({ kind: "video" })).toBeNull();
});
