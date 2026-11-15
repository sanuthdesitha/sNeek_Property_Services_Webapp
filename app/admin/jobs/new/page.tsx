import { redirect } from "next/navigation";

/**
 * The classic New job link opens the New job page (2026-11). The property
 * preselection survives; the classic form component stays in the codebase
 * for parity reference but is no longer an entry point.
 */
export default function NewJobPage({ searchParams }: { searchParams: { propertyId?: string } }) {
  const propertyId = searchParams.propertyId?.trim();
  redirect(propertyId ? `/v2/admin/jobs/new?propertyId=${encodeURIComponent(propertyId)}` : "/v2/admin/jobs/new");
}
