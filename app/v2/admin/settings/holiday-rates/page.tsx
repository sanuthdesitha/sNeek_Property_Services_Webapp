import { requireRole } from "@/lib/auth/session";
import { HolidayRatesWorkspace } from "@/components/finance/holiday-rates-workspace";
export const dynamic = "force-dynamic";
export default async function HolidayRatesPage({ searchParams }: { searchParams?: { jobId?: string } }) {
  await requireRole(["ADMIN"]);
  return <HolidayRatesWorkspace embedded initialJobId={searchParams?.jobId ?? ""} />;
}
