import "server-only";
import { db } from "@/lib/db";
import { propertyScopeWhere, type ClientPortalContext } from "@/lib/auth/client-portal";
import { getClientPortalContext } from "@/lib/client/portal";
import { listClientJobsForUser, listClientReportsForUser } from "@/lib/client/portal-data";
import { projectClientJobList } from "@/lib/client/list-projection";
import { loadPropertyHomeRows, type PropertyHomeRow } from "@/lib/client/property-home";
import { getClientFinanceOverview } from "@/lib/billing/client-portal-finance";
import { getClientImmediateAttention } from "@/lib/dashboard/immediate-attention";
import { listApprovalsForViewer, resolveApprovalViewer } from "@/lib/commercial/client-approval-access";
import { listQuotesWaiting } from "@/lib/client/quotes-waiting";
import type { QuoteWaiting } from "@/components/v2/client/approvals/quote-decision-card";

/**
 * Everything the client Home (phone) and dashboard (desktop) show, loaded once.
 *
 * Every section follows the visibility switches and VA grants exactly as the
 * Home page did before; each section is either data, `null` (could not be
 * loaded: shown as unavailable, never as zero) or not loaded at all because it
 * is hidden for this viewer. New sections for the redesign (decisions, latest
 * message, preferred cleaner, open cases, laundry per property) carry the same
 * checks as the page that already shows that data.
 */
export type HomeVisibility = ClientPortalContext["visibility"];

export interface DecisionSummary {
  count: number;
  /** Sum in AUD when every item is AUD; null otherwise (not summed across currencies). */
  totalAud: number | null;
  titles: string[];
}

export interface LatestOfficeMessage {
  body: string;
  createdAt: Date;
  unread: boolean;
}

export interface PropertyExtras {
  preferredCleaner: Map<string, string | null>;
  openCases: Map<string, number>;
}

type Settled<T> = T | null;
const settle = <T,>(promise: Promise<T>): Promise<Settled<T>> => promise.catch(() => null);

/** Same narrowing the Home page applied: a VA sees only what their grants allow. */
export function homeVisibility(portal: ClientPortalContext): HomeVisibility {
  const visibility = { ...portal.visibility };
  if (portal.actor === "VA") {
    const grants = portal.permissions;
    visibility.showProperties &&= grants.properties;
    visibility.showInventory &&= grants.properties;
    visibility.showReports &&= grants.reports;
    visibility.showFinanceDetails &&= grants.invoicesView;
    visibility.showBooking &&= grants.bookings;
    visibility.showCases &&= grants.maintenance;
    visibility.showShopping = false;
    visibility.showQuoteRequests = false;
    visibility.showApprovals = false;
  }
  return visibility;
}

async function loadDecisions(userId: string): Promise<DecisionSummary> {
  const viewer = await resolveApprovalViewer(userId);
  const rows = viewer ? await listApprovalsForViewer(viewer, { status: "PENDING", strict: true }) : [];
  const allAud = rows.every((row) => (row.currency ?? "AUD").toUpperCase() === "AUD");
  return {
    count: rows.length,
    totalAud: allAud ? rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0) : null,
    titles: rows.map((row) => row.title).filter(Boolean).slice(0, 3),
  };
}

/** `latest: null` means "no office message yet"; a failed read is the outer null. */
async function loadLatestMessage(portal: ClientPortalContext): Promise<{ latest: LatestOfficeMessage | null }> {
  const scope = portal.propertyIds
    ? { OR: [{ jobId: null }, { jobId: { in: (await db.job.findMany({ where: { property: propertyScopeWhere(portal) }, select: { id: true } })).map((job) => job.id) } }] }
    : {};
  const row = await db.clientMessage.findFirst({
    where: { clientId: portal.clientId, isFromAdmin: true, ...scope },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { body: true, createdAt: true, isRead: true },
  });
  return { latest: row ? { body: row.body, createdAt: row.createdAt, unread: !row.isRead } : null };
}

/** Preferred cleaner names (shown on the property page under the same guard) and cases waiting on the client. */
async function loadPropertyExtras(portal: ClientPortalContext, visibility: HomeVisibility): Promise<PropertyExtras> {
  const where = { ...propertyScopeWhere(portal), isActive: true };
  const [properties, cases] = await Promise.all([
    db.property.findMany({ where, select: { id: true, preferredCleanerUserId: true } }),
    visibility.showCases
      ? db.issueTicket.groupBy({ by: ["propertyId"], where: { clientId: portal.clientId, clientVisible: true, state: "AWAITING_CLIENT", property: where }, _count: { _all: true } })
      : Promise.resolve([]),
  ]);
  const cleanerIds = properties.map((row) => row.preferredCleanerUserId).filter((id): id is string => Boolean(id));
  const cleaners = cleanerIds.length
    ? await db.user.findMany({ where: { id: { in: cleanerIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(cleaners.map((user) => [user.id, user.name?.trim() || "Cleaner"]));
  return {
    preferredCleaner: new Map(properties.map((row) => [row.id, row.preferredCleanerUserId ? names.get(row.preferredCleanerUserId) ?? null : null])),
    openCases: new Map((cases as Array<{ propertyId: string | null; _count: { _all: number } }>).flatMap((row) => (row.propertyId ? [[row.propertyId, row._count._all] as const] : []))),
  };
}

export async function loadClientHome(portal: ClientPortalContext) {
  const visibility = homeVisibility(portal);
  const propertyWhere = propertyScopeWhere(portal);
  const legacy = await settle(getClientPortalContext(portal.userId));
  const clientId = legacy?.clientId ?? null;
  const isClient = portal.actor === "CLIENT";
  const showDecisions = isClient && visibility.showApprovals;

  const [jobs, reports, finance, properties, stocks, laundry, attention, decisions, quotes, latestMessage, extras] = await Promise.all([
    settle(listClientJobsForUser(portal.userId).then((rows) => projectClientJobList(rows, visibility))),
    visibility.showReports ? settle(listClientReportsForUser(portal.userId)) : Promise.resolve([]),
    clientId && visibility.showFinanceDetails ? settle(getClientFinanceOverview(clientId, portal.propertyIds)) : Promise.resolve(null),
    visibility.showProperties ? (clientId ? settle(loadPropertyHomeRows(portal)) : Promise.resolve(null)) : Promise.resolve([] as PropertyHomeRow[]),
    visibility.showInventory
      ? clientId
        ? settle(db.propertyStock.findMany({
            where: { property: propertyWhere },
            include: { property: { select: { id: true, name: true } }, item: { select: { name: true } } },
            orderBy: [{ property: { name: "asc" } }, { item: { name: "asc" } }],
            take: 2000,
          }))
        : Promise.resolve(null)
      : Promise.resolve([]),
    visibility.showLaundryUpdates
      ? clientId
        ? settle(db.laundryTask.findMany({
            where: { property: propertyWhere },
            select: {
              id: true, status: true, pickupDate: true, dropoffDate: true, droppedAt: true,
              property: { select: { id: true, name: true, suburb: true } },
              confirmations: { orderBy: { createdAt: "desc" }, take: 3, select: { notes: true } },
            },
            orderBy: [{ pickupDate: "desc" }],
            take: 60,
          }))
        : Promise.resolve(null)
      : Promise.resolve([]),
    clientId ? settle(getClientImmediateAttention({ clientId, visibility, propertyIds: portal.propertyIds })) : Promise.resolve(null),
    showDecisions ? settle(loadDecisions(portal.userId)) : Promise.resolve(null),
    showDecisions && clientId ? settle(listQuotesWaiting(clientId)) : Promise.resolve(showDecisions ? null : ([] as QuoteWaiting[])),
    portal.permissions.messages ? settle(loadLatestMessage(portal)) : Promise.resolve(undefined),
    visibility.showProperties && clientId ? settle(loadPropertyExtras(portal, visibility)) : Promise.resolve(null),
  ]);

  const failed = [
    !clientId && "Account",
    jobs === null && "Services",
    reports === null && "Reports",
    properties === null && "Properties",
    stocks === null && "Inventory",
    laundry === null && "Laundry",
    attention === null && "Attention",
    visibility.showFinanceDetails && finance === null && "Finance",
    showDecisions && (decisions === null || quotes === null) && "Approvals",
    latestMessage === null && "Messages",
  ].filter((value): value is string => Boolean(value));

  return {
    portal,
    visibility,
    clientId,
    clientName: legacy?.client?.name ?? null,
    showDecisions,
    showMessages: portal.permissions.messages === true,
    jobs, reports, finance, properties, stocks, laundry, attention, decisions, quotes, latestMessage, extras,
    failed,
  };
}

export type ClientHomeData = Awaited<ReturnType<typeof loadClientHome>>;
