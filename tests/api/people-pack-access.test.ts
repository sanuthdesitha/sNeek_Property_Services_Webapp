// @vitest-environment node
/**
 * People page per pack: each tab gated by its own pack on the server, no
 * Staff accounts data in the payload without that pack, and the Cleaners list
 * for a workforce-only manager forced to cleaners.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AccountRow } from "@/lib/accounts/list/types";

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  viewer: vi.fn(),
  overview: vi.fn(),
  figures: vi.fn(),
  rows: vi.fn(),
  directory: vi.fn(),
  db: {
    client: { findMany: vi.fn(async () => [{ id: "c1", name: "Client", email: null }]), count: vi.fn(async () => 7) },
    user: { groupBy: vi.fn(async () => [{ role: "CLEANER", _count: { _all: 3 } }, { role: "ADMIN", _count: { _all: 1 } }]), count: vi.fn(async () => 3) },
    userInvitation: { count: vi.fn(async () => 2) },
  },
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: m.redirect, notFound: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/accounts/viewer", () => ({ resolveAccountsViewer: m.viewer }));
vi.mock("@/lib/accounts/overview", () => ({ getAccountsOverview: m.overview }));
vi.mock("@/lib/people/cleaner-figures", async (load) => ({ ...(await load<typeof import("@/lib/people/cleaner-figures")>()), loadCleanerFigures: m.figures }));
vi.mock("@/lib/laundry/partners", () => ({ loadSupplierDirectory: async () => ({ rows: [] }) }));
vi.mock("@/lib/accounts/list/service", () => ({ loadAccountRows: m.rows }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/components/v2/admin/people/people-directory", () => ({ PeopleDirectory: (props: unknown) => ({ props }) }));

import PeoplePage from "@/app/v2/admin/accounts/page";
import { GET as CLEANERS } from "@/app/api/admin/people/cleaners/route";
import { EMPTY_CLEANER_FIGURES } from "@/lib/people/cleaner-figures";

type Viewer = { isAdmin: boolean; canSeeClients: boolean; canOpenPeople: boolean; canSeeWorkforce: boolean };
const viewerFor = (packs: Partial<Viewer>) => ({
  id: "me",
  isAdmin: false,
  canWriteNotes: packs.canOpenPeople === true,
  canUploadDocuments: false,
  canMessageStaff: false,
  canSeeClients: false,
  canOpenPeople: false,
  canSeeWorkforce: false,
  visibility: { pay: true, quality: false },
  ...packs,
});
type PageProps = { initialTab: string; access: Record<string, boolean>; counts: Record<string, number | null>; birthdays: unknown[]; vaClients: unknown[]; cleanerFigures: unknown; capabilities: Record<string, unknown> };
async function render(tab?: string): Promise<PageProps> {
  const element = (await PeoplePage({ searchParams: tab ? { tab } : {} })) as unknown as { props: PageProps };
  return element.props;
}
function row(id: string, role: AccountRow["role"]): AccountRow {
  return { id, name: id, email: `${id}@x`, phone: null, role, extraRoles: [], status: "ACTIVE", inviteAgeDays: null, emailVerified: true, twoFactorEnabled: false, clientName: null, rate: 30, documents: { kind: "OK", label: "OK" } as AccountRow["documents"], jobsWeek: 0, owed: 0, lastSeenAt: null, attention: ["INVITE_STALE"] as AccountRow["attention"] };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue({ user: { id: "me", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } });
  m.overview.mockResolvedValue({ upcomingBirthdays: [{ id: "u", name: "Staff", nextBirthday: new Date(), daysUntil: 3, turningAge: 30 }] });
  m.figures.mockResolvedValue({ ...EMPTY_CLEANER_FIGURES, activeCleaners: 3 });
  m.rows.mockResolvedValue([row("cl1", "CLEANER"), row("cl2", "CLEANER"), row("ad", "ADMIN"), row("va", "VA"), row("cli", "CLIENT")]);
});

describe("clients-only manager", () => {
  it("sees the Clients tab only and receives no Staff accounts data", async () => {
    m.viewer.mockResolvedValue(viewerFor({ canSeeClients: true }));
    const props = await render("office");
    expect(props.initialTab).toBe("clients");
    expect(props.access).toEqual({ clients: true, accounts: false, workforce: false });
    expect(props.birthdays).toEqual([]);
    expect(props.vaClients).toEqual([]);
    expect(props.cleanerFigures).toEqual(EMPTY_CLEANER_FIGURES);
    expect(props.counts).toEqual({ clients: 7, cleaners: null, office: null, partners: null, assistants: null, invitationsOpen: null, everyone: null });
    expect(m.overview).not.toHaveBeenCalled();
    expect(m.db.user.groupBy).not.toHaveBeenCalled();
    expect(m.db.client.findMany).not.toHaveBeenCalled();
    expect(m.figures).not.toHaveBeenCalled();
  });
});

describe("workforce-only manager", () => {
  it("opens on Cleaners whatever tab is asked for, with cleaner figures and no Staff accounts data", async () => {
    m.viewer.mockResolvedValue(viewerFor({ canSeeWorkforce: true }));
    for (const tab of ["office", "everyone", "clients", undefined]) {
      const props = await render(tab);
      expect(props.initialTab, String(tab)).toBe("cleaners");
      expect(props.capabilities.canOpenPeople).toBe(false);
      expect(props.birthdays).toEqual([]);
      expect(props.counts).toMatchObject({ cleaners: 3, office: null, everyone: null, clients: null });
    }
    expect(m.overview).not.toHaveBeenCalled();
    expect(m.db.user.groupBy).not.toHaveBeenCalled();
    expect(m.figures).toHaveBeenCalledWith({ workforce: true, pay: true });
  });

  it("gets the cleaners list with the role forced: other roles never leave the server", async () => {
    m.viewer.mockResolvedValue(viewerFor({ canSeeWorkforce: true }));
    for (const query of ["paginated=1&tab=cleaners", "paginated=1&tab=everyone", "paginated=1&tab=office", "paginated=1&tab=attention"]) {
      const response = await CLEANERS(new NextRequest(`http://localhost/api/admin/people/cleaners?${query}`));
      expect(response.status, query).toBe(200);
      const body = await response.json();
      expect(body.tab).toBe("cleaners");
      expect(body.rows.map((item: AccountRow) => item.role)).toEqual(["CLEANER", "CLEANER"]);
      expect(body.counts.everyone).toBe(2);
      expect(body.counts.office).toBe(0);
      expect(body.summary.people).toBe(2);
    }
    const asAdmin = await CLEANERS(new NextRequest("http://localhost/api/admin/people/cleaners?tab=everyone&role=ADMIN"));
    expect(asAdmin.status).toBe(400);
  });

  it("the route keeps the live guard (a refused pack is 403)", async () => {
    m.requireRole.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await CLEANERS(new NextRequest("http://localhost/api/admin/people/cleaners"))).status).toBe(403);
  });
});

describe("accounts manager and administrator unchanged", () => {
  it("accounts manager: every staff tab, birthdays and counts as before", async () => {
    m.viewer.mockResolvedValue(viewerFor({ canOpenPeople: true, canSeeClients: true, canSeeWorkforce: true }));
    const props = await render("office");
    expect(props.initialTab).toBe("office");
    expect(props.birthdays).toHaveLength(1);
    expect(props.vaClients).toHaveLength(1);
    expect(props.counts).toMatchObject({ clients: 7, cleaners: 3, office: 1, invitationsOpen: 2 });
    expect(props.capabilities.canOpenPeople).toBe(true);
  });

  it("accounts manager without clients falls back to Cleaners, as before", async () => {
    m.viewer.mockResolvedValue(viewerFor({ canOpenPeople: true }));
    expect((await render()).initialTab).toBe("cleaners");
    expect((await render("clients")).initialTab).toBe("cleaners");
  });

  it("ADMIN: everything", async () => {
    m.requireRole.mockResolvedValue({ user: { id: "a", role: "ADMIN", heldRoles: ["ADMIN"] } });
    m.viewer.mockResolvedValue(viewerFor({ isAdmin: true, canOpenPeople: true, canSeeClients: true, canSeeWorkforce: true }));
    const props = await render();
    expect(props.initialTab).toBe("clients");
    expect(props.access).toEqual({ clients: true, accounts: true, workforce: true });
    expect(props.birthdays).toHaveLength(1);
  });

  it("a viewer with none of the three packs is sent to the access-denied page", async () => {
    m.viewer.mockResolvedValue(viewerFor({}));
    await expect(render()).rejects.toThrow("REDIRECT:/v2/admin/access-denied");
  });
});
