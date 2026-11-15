/**
 * Regression (2026-11): the admin rail showed only "My profile" on every full
 * page load until /api/me/ops-permissions answered, and for good when that
 * read failed. The server now seeds the provider with the answer it resolved
 * while rendering the page; a failed refresh keeps the last verified answer.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OpsAccessProvider, useOpsAccess } from "@/components/shared/ops-access-provider";
import { OPS_FEATURE_KEYS, type OpsLevels } from "@/lib/rbac/ops-catalog";

const session = vi.hoisted(() => ({ value: { data: null as unknown, status: "loading" as string } }));
vi.mock("next-auth/react", () => ({ useSession: () => session.value }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/admin/jobs", useSearchParams: () => new URLSearchParams() }));

const JOBS_OFF = Object.fromEntries(OPS_FEATURE_KEYS.map((key) => [key, key === "jobs" ? "off" : "manage"])) as OpsLevels;

function Probe() {
  const { canAccess, seedRole } = useOpsAccess();
  return <p>{["/v2/admin/jobs", "/v2/admin/accounts", "/v2/admin/profile"].filter((href) => canAccess(href)).join(",")}|{seedRole ?? "none"}</p>;
}

beforeEach(() => {
  session.value = { data: null, status: "loading" };
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("without a seed, a pending read hides every mapped page (the old symptom)", () => {
  render(<OpsAccessProvider><Probe /></OpsAccessProvider>);
  expect(screen.getByText(/^\/v2\/admin\/profile\|none$/)).toBeVisible();
});

it("an administrator's seed shows the whole rail while the session and the read are pending", () => {
  render(<OpsAccessProvider seed={{ userId: "admin", role: "ADMIN", levels: null }}><Probe /></OpsAccessProvider>);
  expect(screen.getByText("/v2/admin/jobs,/v2/admin/accounts,/v2/admin/profile|ADMIN")).toBeVisible();
});

it("a manager's seed keeps their restrictions", () => {
  session.value = { data: { user: { id: "ops", role: "OPS_MANAGER" } }, status: "authenticated" };
  render(<OpsAccessProvider seed={{ userId: "ops", role: "OPS_MANAGER", levels: JOBS_OFF }}><Probe /></OpsAccessProvider>);
  expect(screen.getByText(/^\/v2\/admin\/accounts,\/v2\/admin\/profile\|OPS_MANAGER$/)).toBeVisible();
});

it("a seed for somebody else is ignored", () => {
  session.value = { data: { user: { id: "someone-else", role: "OPS_MANAGER" } }, status: "authenticated" };
  render(<OpsAccessProvider seed={{ userId: "admin", role: "ADMIN", levels: null }}><Probe /></OpsAccessProvider>);
  expect(screen.getByText(/^\/v2\/admin\/profile\|none$/)).toBeVisible();
});

it("a failed refresh keeps the verified answer and warns", async () => {
  session.value = { data: { user: { id: "admin", role: "ADMIN" } }, status: "authenticated" };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "x" }) })));
  await act(async () => { render(<OpsAccessProvider seed={{ userId: "admin", role: "ADMIN", levels: null }}><Probe /></OpsAccessProvider>); });
  expect(screen.getByRole("alert")).toHaveTextContent("Navigation permissions could not be verified.");
  expect(screen.getByText("/v2/admin/jobs,/v2/admin/accounts,/v2/admin/profile|ADMIN")).toBeVisible();
});
