import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { listClientPropertiesForUser } from "@/lib/client/portal-data";
import { BookingWizard } from "@/components/client/booking-wizard";

export default async function ClientBookingPage() {
  await ensureClientModuleAccess("booking");
  const session = await requireRole([Role.CLIENT]);
  const properties = await listClientPropertiesForUser(session.user.id);

  return <BookingWizard properties={properties} />;
}
