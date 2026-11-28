/** "Camera not working — ask the office" on Wrap up: states, draft kept after a failed send, one send per tap, re-read once when allowed. */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvidenceOverrideRequest } from "@/components/v2/cleaner/evidence-override-request";

const missing = [{ fieldId: "bench", label: "Bench photo" }, { fieldId: "oven", label: "Oven photo" }];
const base = { jobId: "job-1", requests: [], allowedFieldIds: [], canAsk: true, refusal: null, timeZone: "Australia/Sydney" };

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EvidenceOverrideRequest", () => {
  it("keeps the draft after a failed send and sends once per tap", async () => {
    fetchMock.mockImplementationOnce(() => respond(base));
    render(<EvidenceOverrideRequest jobId="job-1" missingPhotos={missing} allowedInPayload={[]} onAllowedChanged={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Camera not working — ask the office/ }));
    expect(screen.getByRole("checkbox", { name: "Bench photo" })).toBeChecked();
    fireEvent.change(screen.getByLabelText(/Why/), { target: { value: "Camera shows black" } });
    let release: (value: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Send to the office" }));
    fireEvent.click(screen.getByRole("button", { name: "Send to the office" }));
    expect(screen.getByLabelText(/Why/)).toBeDisabled();
    await act(async () => release(new Response(JSON.stringify({ error: "Could not reach the office." }), { status: 500 })));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the office.");
    expect(screen.getByLabelText(/Why/)).toHaveValue("Camera shows black");
    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(1);
    const firstKey = JSON.parse(String((posts[0][1] as RequestInit).body)).requestKey;
    fetchMock.mockImplementationOnce(() => respond({ outcome: "CREATED" }, 201));
    fetchMock.mockImplementationOnce(() => respond({ ...base, canAsk: false, refusal: "The office has not answered yet.", requests: [{ id: "r1", status: "REQUESTED", note: "Camera shows black", fields: missing, allowedFieldIds: [], decisionReason: null, askedAt: "2026-11-28T01:00:00Z", decidedAt: null }] }));
    fireEvent.click(screen.getByRole("button", { name: "Send to the office" }));
    expect(await screen.findByText("Waiting for the office")).toBeInTheDocument();
    const retry = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")[1];
    expect(JSON.parse(String((retry[1] as RequestInit).body)).requestKey).toBe(firstKey);
  });

  it("an allowance the job form does not know yet re-reads the form once", async () => {
    const onAllowed = vi.fn();
    fetchMock.mockImplementation(() => respond({ ...base, allowedFieldIds: ["bench"], requests: [{ id: "r1", status: "ALLOWED", note: "x", fields: missing, allowedFieldIds: ["bench"], decisionReason: "Phone broken", askedAt: "2026-11-28T01:00:00Z", decidedAt: "2026-11-28T02:00:00Z" }] }));
    const view = render(<EvidenceOverrideRequest jobId="job-1" missingPhotos={[missing[1]]} allowedInPayload={[]} onAllowedChanged={onAllowed} />);
    expect(await screen.findByText(/You can submit without: Bench photo/)).toBeInTheDocument();
    await waitFor(() => expect(onAllowed).toHaveBeenCalledTimes(1));
    view.rerender(<EvidenceOverrideRequest jobId="job-1" missingPhotos={[missing[1]]} allowedInPayload={[]} onAllowedChanged={onAllowed} />);
    expect(onAllowed).toHaveBeenCalledTimes(1);
  });

  it("a failed read says so (never 'nothing asked')", async () => {
    fetchMock.mockImplementation(() => respond({ error: "Could not check with the office." }, 500));
    render(<EvidenceOverrideRequest jobId="job-1" missingPhotos={missing} allowedInPayload={[]} onAllowedChanged={vi.fn()} />);
    expect(await screen.findByText("Could not check with the office.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });
});
