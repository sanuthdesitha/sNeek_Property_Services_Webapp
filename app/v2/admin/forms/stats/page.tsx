import { redirect } from "next/navigation";
import { formsTabRedirect } from "@/lib/admin/forms-redirects";

// Form statistics are the "Results and stats" tab of the Forms library.
// `templateId` and `weeks` are carried across, so old links open the same view.
export default function EstateFormStatsRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  redirect(formsTabRedirect("stats", searchParams));
}
