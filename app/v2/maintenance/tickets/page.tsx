import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { MaintenanceTicketsWorkspace } from "@/components/v2/maintenance/tickets-workspace";

export const metadata = { title: "Tickets · Estate maintenance" };
export const dynamic = "force-dynamic";

export default async function MaintenanceTicketsPage({ searchParams = {} }: { searchParams?: { page?: string } }) {
  const session = await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);
  const requestedPage = Number(searchParams.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100_000) : 1;
  // Match the worker detail API's existing userIsAssignedWorker predicate.
  // Admin/ops retain the business-wide view; access instructions stay in detail.
  const where = session.user.role === Role.MAINTENANCE ? { assignedWorker: { userId: session.user.id } } : {};
  const [tickets, totalCount] = await Promise.all([db.propertyMaintenanceItem.findMany({
    where,
    orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    take: 50, skip: (page - 1) * 50,
    select: {
      id: true, title: true, priority: true, status: true, scheduledFor: true,
      enRouteAt: true, arrivedAt: true, clockInAt: true, clockOutAt: true,
      outcome: true, costApprovalStatus: true,
      property: { select: { name: true, suburb: true } },
    },
  }).catch(() => null), db.propertyMaintenanceItem.count({ where }).catch(() => null)]);

  return <div className="space-y-6">
    <EPageHeader eyebrow="Work orders" title="Tickets" description={`${session.user.role === Role.MAINTENANCE ? "Your assigned maintenance requests." : "Business-wide maintenance requests."} Open a ticket for its available visit actions.`} />
    <MaintenanceTicketsWorkspace page={page} totalCount={totalCount} tickets={tickets?.map((ticket) => ({
      ...ticket,
      scheduledFor: ticket.scheduledFor?.toISOString() ?? null,
      enRouteAt: ticket.enRouteAt?.toISOString() ?? null,
      arrivedAt: ticket.arrivedAt?.toISOString() ?? null,
      clockInAt: ticket.clockInAt?.toISOString() ?? null,
      clockOutAt: ticket.clockOutAt?.toISOString() ?? null,
    })) ?? null} />
  </div>;
}
