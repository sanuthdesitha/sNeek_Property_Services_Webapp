import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createHash, webcrypto } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ id: "cleaner-a" }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated", data: { user: { id: auth.id } } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import { JobOfferActions } from "@/components/v2/cleaner/job-offer-actions";
const identity = (id: string) => createHash("sha256").update(JSON.stringify(["cleaner-draft-identity-v1", id, id, "job"])).digest("hex");
beforeEach(() => { sessionStorage.clear(); auth.id = "cleaner-a"; vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("allows an explicit retry only after authenticated PENDING status is freshly verified", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("lost"))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, state: "CANCELLED", result: { status: 409, body: { error: "cancelled" } } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ draftIdentity: identity(auth.id), job: { id: "job" }, assignmentState: { responseStatus: "PENDING" } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
  vi.stubGlobal("fetch", fetcher);
  render(<JobOfferActions jobId="job"/>);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Accept", exact: true })));
  await waitFor(() => expect(screen.getByText("Check assignment status")).toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Accept", exact: true })).toBeDisabled();
  await act(async () => fireEvent.click(screen.getByText("Check assignment status")));
  await waitFor(() => expect(screen.getByRole("button", { name: "Accept", exact: true })).toBeEnabled());
  expect(fetcher).toHaveBeenCalledTimes(3);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Accept", exact: true })));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
});
it("rejects a status read from a changed account and does not expose the old marker after account switch", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("lost"))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, state: "CANCELLED", result: { status: 409, body: { error: "cancelled" } } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ draftIdentity: identity("cleaner-b"), job: { id: "job" }, assignmentState: { responseStatus: "PENDING" } }))));
  const view = render(<JobOfferActions jobId="job"/>);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Accept", exact: true })));
  await waitFor(() => expect(screen.getByText("Check assignment status")).toBeInTheDocument());
  await act(async () => fireEvent.click(screen.getByText("Check assignment status")));
  await waitFor(() => expect(screen.getByText("Check assignment status")).toBeEnabled());
  expect(screen.getByRole("button", { name: "Accept", exact: true })).toBeDisabled();
  auth.id = "cleaner-b"; view.rerender(<JobOfferActions jobId="job"/>);
  expect(screen.queryByText("Check assignment status")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
});
