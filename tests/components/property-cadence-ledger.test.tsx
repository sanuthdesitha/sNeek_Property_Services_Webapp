import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PropertyCadenceLedger } from "@/components/v2/admin/properties/property-cadence-ledger";
const request = vi.fn();
const data = { reviewedJobs: 4, limited: false, rows: [
 { key: "deep", label: "Deep clean", status: "CURRENT", lastEvidence: { jobId: "j", day: "2026-10-01", basis: "Checklist photo" }, dueDay: "2027-01-01" },
 { key: "skirting", label: "Skirting", status: "DUE", lastEvidence: null, dueDay: "2026-10-05" },
 { key: "cobweb", label: "Cobwebs", status: "OVERDUE", lastEvidence: null, dueDay: "2026-09-28" },
 { key: "detail", label: "Detail", status: "UNVERIFIED", lastEvidence: null, dueDay: null },
] };
const response = (value = data) => ({ ok: true, json: async () => value });
beforeEach(() => { request.mockReset(); vi.stubGlobal("fetch", request); });
afterEach(() => vi.unstubAllGlobals());
it("shows loading then all review states and evidence links without writes", async () => {
 request.mockResolvedValue(response()); render(<PropertyCadenceLedger propertyId="p" />);
 expect(screen.getByText("Loading evidence…")).toBeInTheDocument();
 expect(await screen.findByText("Current evidence")).toBeInTheDocument();
 expect(screen.getByText("Due — review")).toBeInTheDocument(); expect(screen.getByText("Overdue — review")).toBeInTheDocument(); expect(screen.getByText("Unverified")).toBeInTheDocument();
 expect(screen.getByRole("link", { name: "2026-10-01" })).toHaveAttribute("href", "/admin/jobs/j");
 expect(screen.getByText("Review baseline")).toBeInTheDocument();
 expect(screen.queryByText(/Only the latest 500/)).not.toBeInTheDocument();
 expect(request).toHaveBeenCalledOnce(); expect(request).toHaveBeenCalledWith("/api/admin/properties/p/cadence-ledger", { cache: "no-store" });
});
it("discloses truncated evidence and clears previous property results during navigation", async () => {
 request.mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ ...data, reviewedJobs: 500, limited: true }));
 const view = render(<PropertyCadenceLedger propertyId="p" />); await screen.findByText("Current evidence");
 view.rerender(<PropertyCadenceLedger propertyId="other" />); expect(screen.getByText("Loading evidence…")).toBeInTheDocument();
 expect(await screen.findByText(/Only the latest 500/)).toBeInTheDocument();
 expect(request).toHaveBeenLastCalledWith("/api/admin/properties/other/cadence-ledger", { cache: "no-store" });
});
it.each(["http", "network"])("shows failure instead of stale assurance after %s error", async kind => {
 request.mockImplementation(() => kind === "http" ? Promise.resolve({ ok: false }) : Promise.reject(new Error("offline")));
 render(<PropertyCadenceLedger propertyId="p" />);
 expect(await screen.findByRole("alert")).toHaveTextContent("Do not treat missing results as up to date");
});
it.each(["success", "failure"])("ignores late %s from a previous property", async kind => {
 let resolveOld!: (value: any) => void; let rejectOld!: (error: Error) => void;
 request.mockImplementationOnce(() => new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; })).mockResolvedValueOnce(response({ ...data, reviewedJobs: 500, limited: true }));
 const view = render(<PropertyCadenceLedger propertyId="old" />); view.rerender(<PropertyCadenceLedger propertyId="new" />);
 await screen.findByText(/Only the latest 500/);
 await act(async () => { if (kind === "success") resolveOld(response()); else rejectOld(new Error("old error")); });
 expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(screen.getByText(/Only the latest 500/)).toBeInTheDocument();
});
