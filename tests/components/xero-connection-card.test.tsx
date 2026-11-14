/** Settings › Xero connection card: states, reasons, Reconnect, history in the organisation timezone. */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { XeroConnectionCard, formatXeroTime, type XeroStatusView } from "@/components/v2/admin/settings/xero-connection-card";
import { buildXeroStatus } from "@/lib/xero/connection-status";

const now = new Date("2026-11-15T01:00:00Z");
const base = { tenantName: "Fixture Org", refreshToken: "enc:v1:x", expiresAt: new Date("2026-11-15T01:30:00Z"), connectedAt: new Date("2026-11-01T00:00:00Z"), lastRefreshedAt: new Date("2026-11-15T00:59:00Z") };

function renderCard(view: XeroStatusView) {
  const onConnect = vi.fn();
  render(<XeroConnectionCard view={view} connecting={false} disconnecting={false} onConnect={onConnect} onDisconnect={vi.fn()} />);
  return onConnect;
}

describe("XeroConnectionCard", () => {
  it("shows a healthy connection with since, last and next refresh, keep-alive and the 60-day limit", () => {
    renderCard({ ...buildXeroStatus({ ...base, status: "CONNECTED" }, now), timezone: "Australia/Sydney" });
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Organisation · Fixture Org")).toBeInTheDocument();
    expect(screen.getByText("Connected since")).toBeInTheDocument();
    expect(screen.getByText(formatXeroTime("2026-11-15T00:59:00.000Z", "Australia/Sydney"))).toBeInTheDocument();
    expect(screen.getByText(/or the next Xero call after it/)).toBeInTheDocument();
    expect(screen.getByText("Daily at 3:47 am (Australia/Sydney)")).toBeInTheDocument();
    expect(screen.getByText("Must renew by (60 days unused)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reconnect/ })).toBeInTheDocument();
  });

  it("says 'Reconnect Xero once to keep it connected' for a connection without a refresh token", async () => {
    const onConnect = renderCard({ ...buildXeroStatus({ ...base, refreshToken: "" }, now), timezone: "Australia/Sydney" });
    expect(screen.getByText("Reconnect Xero once to keep it connected")).toBeInTheDocument();
    expect(screen.getByText("Cannot renew until reconnected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Reconnect/ }));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("shows needs reconnect with the stored reason", () => {
    renderCard({ ...buildXeroStatus({ ...base, status: "NEEDS_RECONNECT", statusReasonCode: "REFRESH_REJECTED", statusReason: "Xero refused to renew the sign-in (invalid_grant).", needsReconnectAt: now }, now), timezone: "Australia/Sydney" });
    expect(screen.getByText("Needs reconnect")).toBeInTheDocument();
    expect(screen.getByText("Xero needs reconnecting")).toBeInTheDocument();
    expect(screen.getByText("Xero refused to renew the sign-in (invalid_grant).")).toBeInTheDocument();
  });

  it("never shows a failed renewal as plainly connected", () => {
    renderCard({ ...buildXeroStatus({ ...base, lastRefreshError: "Xero was unavailable (503)." }, now), timezone: "Australia/Sydney" });
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(screen.getByText("Connected · renewal retrying")).toBeInTheDocument();
    expect(screen.getByText(/The last sign-in renewal failed/)).toBeInTheDocument();
  });

  it("offers Connect when there is no connection", () => {
    renderCard({ connected: false, timezone: "Australia/Sydney" });
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect to Xero/ })).toBeInTheDocument();
  });
});
