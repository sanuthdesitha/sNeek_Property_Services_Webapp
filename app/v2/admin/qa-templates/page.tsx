import { redirect } from "next/navigation";
import { formsTabRedirect } from "@/lib/admin/forms-redirects";

// QA templates are the "QA templates" tab of the Forms library.
export default function AdminQaTemplatesRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  redirect(formsTabRedirect("qa", searchParams));
}
