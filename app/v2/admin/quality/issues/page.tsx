import { redirect } from "next/navigation";
import { qualityTabRedirect } from "@/lib/quality/redirects";

// QA issues is the Issues tab of the Quality hub. Filters (cleanerId,
// propertyId, category, severity, rectificationStatus, falseConfirmation) are
// carried across under the same names; from/to become a custom period. The
// hub itself checks the role (QA inspectors keep read-only access).
export default function V2AdminQaIssuesRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  redirect(qualityTabRedirect("issues", searchParams));
}
