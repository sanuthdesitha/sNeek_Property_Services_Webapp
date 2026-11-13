// @vitest-environment node
/**
 * The "agent request waiting" notice: INBOX only through the intent pipeline,
 * scope AGENT_ACTION_APPROVER, and the scope's own rule (who could approve
 * this request now; only while it still waits).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ send: vi.fn(), users: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { user: { findMany: m.users } } }));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: m.send }));
vi.mock("@/lib/notifications/type-controls", () => ({ getNotificationTypeControls: async () => ({ disabledTransports: {} }), typeRespectsPreferences: () => false }));
vi.mock("@/lib/notifications/wording/render", () => ({
  loadNotificationWording: async () => ({ render: (_part: string, _transport: string, vars: Record<string, string>) => ({ title: `Agent request waiting: ${vars.agentName}`, body: `${vars.agentName} asks to: ${vars.summary}` }) }),
}));
import { sendAgentRequestNotice } from "@/lib/notifications/agent-requests";
import { agentApproverRecipientAllowed, authorizeEntityRecipient } from "@/lib/notifications/recipient-scopes";
import { catalogEntry } from "@/lib/notifications/catalog";
import { wordingDefinition } from "@/lib/notifications/wording/registry";

beforeEach(() => {
  vi.resetAllMocks();
  m.send.mockResolvedValue([]);
  m.users.mockResolvedValue([{ id: "admin-1", role: "ADMIN", name: "Owner", email: "o@example.invalid" }, { id: "ops-1", role: "OPS_MANAGER", name: "Manager", email: "m@example.invalid" }]);
});

describe("agent request notice", () => {
  it("goes to the inbox only, through the pipeline scope that re-checks each approver", async () => {
    await sendAgentRequestNotice({ requestId: "req-1", agentName: "Hermes", summary: "Reschedule job J-1." });
    expect(m.send).toHaveBeenCalledTimes(1);
    const input = m.send.mock.calls[0][0];
    expect(input).toMatchObject({ typeKey: "agent.action_request", eventKey: "agent.action_request", eventId: "agent-request:req-1", transports: ["INBOX"], scopeType: "AGENT_ACTION_APPROVER", severity: "ACTION" });
    expect(input.scopeId({ id: "ops-1" })).toBe("req-1");
    expect(input.email).toBeUndefined();
    expect(input.recipients.map((person: { id: string }) => person.id)).toEqual(["admin-1", "ops-1"]);
  });

  it("is in the catalog as inbox-only pipeline, with editable wording", () => {
    expect(catalogEntry("agent.action_request")).toMatchObject({ transports: ["INBOX"], defaultTransports: ["INBOX"], path: "PIPELINE", producers: ["lib/notifications/agent-requests.ts"] });
    expect(wordingDefinition("agent.action_request")?.status).toBe("EDITABLE");
  });
});

describe("AGENT_ACTION_APPROVER scope", () => {
  const policy = (overrides: Record<string, string>) => ({ value: { revision: 1, presets: [], assignments: { "ops-1": { presetId: "existing", overrides } } } });
  function reader(request: { status: string; area: string } | null, setting: unknown = null, role = "OPS_MANAGER") {
    return {
      agentActionRequest: { findUnique: vi.fn().mockResolvedValue(request) },
      appSetting: { findUnique: vi.fn().mockResolvedValue(setting) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: "ops-1", role, isActive: true, extraRoles: [], clientId: null, laundrySupplierId: null }) },
      jobAssignment: { findFirst: vi.fn() }, laundryTask: { findUnique: vi.fn() }, job: { findUnique: vi.fn() },
    } as never;
  }

  it("admits an administrator, and a manager who manages the request's areas with Approvals at least read", async () => {
    expect(await agentApproverRecipientAllowed(reader({ status: "WAITING", area: "cases_write" }), { id: "admin-1", role: "ADMIN" as never }, "req-1")).toBe(true);
    expect(await agentApproverRecipientAllowed(reader({ status: "WAITING", area: "cases_write" }, policy({ cases: "manage", approvals: "read" })), { id: "ops-1", role: "OPS_MANAGER" as never }, "req-1")).toBe(true);
  });

  it("refuses a manager who only reads the area, has no Approvals, or a request that is no longer waiting", async () => {
    const ops = { id: "ops-1", role: "OPS_MANAGER" as never };
    expect(await agentApproverRecipientAllowed(reader({ status: "WAITING", area: "cases_write" }, policy({ cases: "read", approvals: "manage" })), ops, "req-1")).toBe(false);
    expect(await agentApproverRecipientAllowed(reader({ status: "WAITING", area: "cases_write" }, policy({ cases: "manage", approvals: "off" })), ops, "req-1")).toBe(false);
    expect(await agentApproverRecipientAllowed(reader({ status: "WAITING", area: "jobs_reschedule" }, policy({ jobs: "manage", calendar: "read", approvals: "manage" })), ops, "req-1")).toBe(false);
    expect(await agentApproverRecipientAllowed(reader({ status: "EXECUTED", area: "cases_write" }), { id: "admin-1", role: "ADMIN" as never }, "req-1")).toBe(false);
    expect(await agentApproverRecipientAllowed(reader(null), { id: "admin-1", role: "ADMIN" as never }, "req-1")).toBe(false);
  });

  it("is a supported entity scope of the pipeline", async () => {
    const result = await authorizeEntityRecipient(reader({ status: "WAITING", area: "cases_write" }, null, "ADMIN"), { userId: "ops-1", role: "ADMIN" as never, scope: { kind: "ENTITY", type: "AGENT_ACTION_APPROVER", id: "req-1" } });
    expect(result).toEqual({ ok: true, role: "ADMIN" });
  });
});
