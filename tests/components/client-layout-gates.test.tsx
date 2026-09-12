import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Layout from "@/app/v2/client/layout";

const mocks = vi.hoisted(() => ({ session: null as any, state: {} as any, identity: "" }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: mocks.session }) }));
vi.mock("@/components/v2/portal/use-attention-counts", () => ({
  useClientPortalCounts: (_endpoint: string, identity: string) => { mocks.identity = identity; return mocks.state; },
  withAttentionBadges: (nav: unknown) => nav,
}));
vi.mock("@/components/v2/portal/portal-shell", () => ({ PortalShell: ({ nav, children }: any) => <><nav>{nav.map((item: any) => <a key={item.href} href={item.href}>{item.label}</a>)}</nav>{children}</> }));
beforeEach(() => {
  mocks.session = { user: { id: "va", role: "VA", name: "Assistant" } };
  mocks.state = { counts: {}, gate: null, status: "loading", refresh: vi.fn() };
});
describe("client layout grants", () => {
  it("refreshes account context when impersonation changes for the same user", () => {
    const view = render(<Layout>Content</Layout>);
    const original = mocks.identity;
    mocks.session = { ...mocks.session, impersonation: { actorId: "admin", mode: "test", startedAt: "2026-09-09T10:00:00Z" } };
    view.rerender(<Layout>Content</Layout>);
    expect(mocks.identity).not.toBe(original);
    expect(JSON.parse(mocks.identity)).toContain("admin");
  });
  it("labels unresolved account identity without claiming confirmed access", () => {
    render(<Layout>Content</Layout>);
    expect(screen.getByRole("region", { name: "Assistant account context" })).toHaveTextContent("Confirming client account...");
  });
  it("never displays identity from a mismatched actor payload", () => {
    mocks.state = { ...mocks.state, status: "ready", gate: { actor: "CLIENT", actingFor: "Wrong account", teamName: "Wrong team", permissions: {} } };
    render(<Layout>Content</Layout>);
    expect(screen.queryByText(/Wrong account|Wrong team/)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Client account not confirmed");
  });
  it("removes previously confirmed account text when access fails", () => {
    mocks.state = { ...mocks.state, status: "ready", gate: { actor: "VA", actingFor: "QA Client", teamName: "QA Team", permissions: {} } };
    const view = render(<Layout>Content</Layout>);
    expect(screen.getByRole("status")).toHaveTextContent("QA Client");
    mocks.state = { ...mocks.state, status: "denied" };
    view.rerender(<Layout>Content</Layout>);
    expect(screen.getByRole("status")).not.toHaveTextContent("QA Client");
    expect(screen.getByRole("status")).toHaveTextContent("Client account not confirmed");
  });
  it("offers no navigation before the session resolves", () => {
    mocks.session = null;
    render(<Layout>Content</Layout>);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
  it("does not offer grant-specific or client-only destinations while grants load", () => {
    render(<Layout>Content</Layout>);
    expect(screen.queryByRole("link", { name: "Book a clean" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Approvals" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Assistants" })).toBeNull();
    expect(screen.getByRole("link", { name: "Jobs" })).toBeVisible();
  });
  it("ignores a mismatched client grant payload for a VA", () => {
    mocks.state = { ...mocks.state, status: "ready", gate: { actor: "CLIENT", permissions: { bookings: true } } };
    render(<Layout>Content</Layout>);
    expect(screen.queryByRole("link", { name: "Book a clean" })).toBeNull();
  });
  it("clears navigation on denied access and offers retry", () => {
    mocks.state.status = "denied";
    render(<Layout>Content</Layout>);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent("access could not be confirmed");
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });
  it("allows only granted destinations, preserving client-only restrictions", () => {
    mocks.state = { ...mocks.state, status: "ready", gate: { actor: "VA", permissions: { bookings: true } } };
    render(<Layout>Content</Layout>);
    expect(screen.getByRole("link", { name: "Book a clean" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Reports" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Approvals" })).toBeNull();
  });
});
