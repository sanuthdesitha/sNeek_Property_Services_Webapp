import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/cleaner/evidence-store", async original => ({ ...await original<typeof import("@/lib/cleaner/evidence-store")>(), listEvidence: mocks.list, getEvidence: mocks.get }));
vi.mock("@/components/v2/cleaner/media-capture", () => ({ prepareAndUploadFiles: mocks.upload }));
import { EvidenceRecovery } from "@/components/v2/cleaner/evidence-recovery";
afterEach(cleanup);
describe("recovery destination acknowledgement", () => {
  it("routes recovery using the latest stored destination after another tab moved the capture", async () => {
    const scope = { jobId: "job", templateId: "template", formRevision: "revision", draftIdentity: "actor" };
    const receipt = { key: "key", url: "/key", kind: "image", name: "proof.jpg" };
    const stale = { ...scope, id: "capture", fieldId: "pool", destination: { type: "bulkPool" }, status: "uploaded", receipt, blob: new Blob(["original"]), filename: "proof.jpg", mime: "image/jpeg", folder: "forms", source: "camera" };
    const latest = { ...stale, destination: { type: "formField", fieldId: "proof" }, fieldId: "proof", status: "attached", destinationVersion: 1 };
    mocks.list.mockResolvedValue([stale]); mocks.get.mockResolvedValue(latest);
    mocks.upload.mockResolvedValue({ results: [receipt], failed: [], failedCount: 0 });
    const recovered = vi.fn();
    render(<EvidenceRecovery scope={scope} locked={false} onRecovered={recovered} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry attachment" }));
    await waitFor(() => expect(recovered).toHaveBeenCalledWith("proof", receipt, latest.destination));
    expect(mocks.upload.mock.calls[0][1].recoveryRecords).toEqual([latest]);
  });
});
