/** "Running late" / "I can't attend": draft kept after a failure, one send per tap, same key on retry. */
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AttendanceNoticeForm } from "@/components/v2/cleaner/attendance-notice-form";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps the reason after a failed send, sends once per tap and retries with the same key", async () => {
  render(<AttendanceNoticeForm jobId="job-1" kind="RUNNING_LATE" />);
  fireEvent.click(screen.getByRole("button", { name: "30 min" }));
  fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Traffic on the bridge" } });
  let release: (value: Response) => void = () => undefined;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "Tell the office" }));
  fireEvent.click(screen.getByRole("button", { name: "Tell the office" }));
  expect(screen.getByLabelText(/Reason/)).toBeDisabled();
  await act(async () => release(new Response(JSON.stringify({ error: "Could not reach the office." }), { status: 500 })));
  expect(screen.getByRole("alert")).toHaveTextContent("Could not reach the office.");
  expect(screen.getByLabelText(/Reason/)).toHaveValue("Traffic on the bridge");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const first = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
  expect(first).toMatchObject({ kind: "RUNNING_LATE", minutes: 30, reason: "Traffic on the bridge" });
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ outcome: "SENT", office: { queued: 2, inInbox: 2 } }), { status: 200 }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tell the office" })); });
  expect(await screen.findByText(/The office has it in their inbox/)).toBeInTheDocument();
  expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)).requestKey).toBe(first.requestKey);
});

it("can't attend needs a reason before anything is sent", () => {
  render(<AttendanceNoticeForm jobId="job-1" kind="CANT_ATTEND" />);
  fireEvent.click(screen.getByRole("button", { name: "Tell the office" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Give a short reason.");
  expect(fetchMock).not.toHaveBeenCalled();
});
