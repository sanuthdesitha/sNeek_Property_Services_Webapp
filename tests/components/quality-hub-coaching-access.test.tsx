import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";
import { qualityHubAccess } from "@/lib/quality/hub-access";

const m = vi.hoisted(() => ({ role: vi.fn(), ops: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import Page from "@/app/v2/admin/quality/page";
import { CoachingWorkspace } from "@/components/v2/admin/workforce/coaching-workspace";

type HubElement = { props: { context: { coaching: { visible: boolean; canManage: boolean; fullPageLink: boolean }; canDecideBonus: boolean } } };

describe("Quality hub tools follow the packs their endpoints require", () => {
  it("an administrator gets every tool regardless of packs", () => {
    expect(qualityHubAccess(null, true)).toEqual({ coaching: { visible: true, canManage: true, fullPageLink: true }, canDecideBonus: true, canProposeBonus: true });
  });

  it("hides Coaching from a manager whose packs refuse the cleaner list (accounts) or coaching records (quality)", () => {
    expect(qualityHubAccess({ ...allOpsLevels("manage"), accounts: "off" }, true).coaching.visible).toBe(false);
    expect(qualityHubAccess({ ...allOpsLevels("manage"), quality: "off" }, false).coaching.visible).toBe(false);
  });

  it("read-only quality keeps Coaching visible but without create or update", () => {
    expect(qualityHubAccess({ ...allOpsLevels("manage"), quality: "read" }, false).coaching).toEqual({ visible: true, canManage: false, fullPageLink: true });
  });

  it("links to the Workforce coaching page only with the workforce pack, and offers bonus decisions only with payroll", () => {
    const access = qualityHubAccess({ ...allOpsLevels("manage"), workforce: "off", payroll: "read" }, true);
    expect(access.coaching).toMatchObject({ visible: true, fullPageLink: false });
    expect(access.canDecideBonus).toBe(false);
    expect(access.canProposeBonus).toBe(false);
  });

  it("offers Propose bonus exactly where a pay adjustment may be created (payroll manage) and quality is manage", () => {
    expect(qualityHubAccess(allOpsLevels("manage"), true).canProposeBonus).toBe(true);
    expect(qualityHubAccess({ ...allOpsLevels("manage"), payroll: "read" }, true).canProposeBonus).toBe(false);
    expect(qualityHubAccess({ ...allOpsLevels("manage"), payroll: "off" }, true).canProposeBonus).toBe(false);
    // Read-only quality: no hub actions at all.
    expect(qualityHubAccess({ ...allOpsLevels("manage"), quality: "read" }, false).canProposeBonus).toBe(false);
  });

  describe("server page", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      m.settings.mockResolvedValue({ timezone: "Australia/Sydney", accountability: { scoring: { falseConfirmationExtraDeduction: 10 } } });
    });

    it("passes the decision to the hub for an operations manager", async () => {
      m.role.mockResolvedValue({ user: { id: "o", role: "OPS_MANAGER" } });
      m.ops.mockResolvedValue({ ...allOpsLevels("manage"), accounts: "off" });
      const element = (await Page()) as unknown as HubElement;
      expect(element.props.context.coaching.visible).toBe(false);
      expect(element.props.context.canDecideBonus).toBe(true);
    });

    it("never offers Coaching to a QA inspector", async () => {
      m.role.mockResolvedValue({ user: { id: "q", role: "QA_INSPECTOR" } });
      const element = (await Page()) as unknown as HubElement;
      expect(element.props.context.coaching.visible).toBe(false);
      expect(element.props.context.canDecideBonus).toBe(false);
    });
  });
});

describe("Coaching workspace never fails quietly", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(handlers: { records: () => Response; users: () => Response }) {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      return Promise.resolve(url.startsWith("/api/admin/users") ? handlers.users() : handlers.records());
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("shows an explicit no-access state instead of an empty list when records are refused", async () => {
    stubFetch({ records: () => Response.json({ error: "Forbidden" }, { status: 403 }), users: () => Response.json([]) });
    render(<CoachingWorkspace />);
    expect(await screen.findByText("You do not have access to coaching records.")).toBeInTheDocument();
    expect(screen.queryByText("No coaching records")).toBeNull();
  });

  it("says the cleaner list failed and disables New record", async () => {
    stubFetch({ records: () => Response.json({ records: [] }), users: () => Response.json({ error: "Forbidden" }, { status: 403 }) });
    render(<CoachingWorkspace />);
    expect(await screen.findByText("The cleaner list could not be loaded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New record/ })).toBeDisabled();
  });

  it("hides create controls for a read-only viewer", async () => {
    stubFetch({ records: () => Response.json({ records: [] }), users: () => Response.json([{ id: "c1", name: "Ana" }]) });
    render(<CoachingWorkspace canManage={false} />);
    await waitFor(() => expect(screen.getByText("No coaching records")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /New record/ })).toBeNull();
  });
});

describe("Quality hub tab row", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("has no Coaching tab when the server hid it, and keeps it otherwise", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json({ error: "not under test" }, { status: 500 }))));
    const { QualityHub } = await import("@/components/v2/admin/quality/hub/quality-hub");
    const base = { canManage: true, inspectorView: false, timeZone: "Australia/Sydney", falseConfirmationDeduction: null };
    const { unmount } = render(<QualityHub context={{ ...base, coaching: { visible: false, canManage: false, fullPageLink: false } }} />);
    const nav = screen.getByRole("navigation", { name: "Quality sections" });
    expect(nav.textContent).not.toContain("Coaching");
    expect(nav.textContent).toContain("Cleaners");
    unmount();
    render(<QualityHub context={{ ...base, coaching: { visible: true, canManage: true, fullPageLink: true } }} />);
    expect(screen.getByRole("navigation", { name: "Quality sections" }).textContent).toContain("Coaching");
  });
});

describe("issue evidence never loads forever", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a refused photo shows as unavailable, not as a loading tile", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json({ error: "Forbidden" }, { status: 403 }))));
    const { EvidenceStrip, useEvidenceUrls } = await import("@/components/v2/admin/quality/issues/issue-evidence");
    function Strip() {
      const urls = useEvidenceUrls(["qa/one.jpg"], "job-1");
      return <EvidenceStrip keys={["qa/one.jpg"]} urls={urls} alt="QA evidence" />;
    }
    render(<Strip />);
    expect(await screen.findByRole("img", { name: "QA evidence: photo unavailable" })).toBeInTheDocument();
  });
});
