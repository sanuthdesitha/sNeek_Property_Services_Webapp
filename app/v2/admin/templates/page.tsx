import { redirect } from "next/navigation";
import { formsTabRedirect } from "@/lib/admin/forms-redirects";

// Notification and message templates are the "Message templates" tab of the
// Forms library; the old `tab=messages|notifications` picks its view.
export default function EstateTemplatesRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  redirect(formsTabRedirect("messages", searchParams));
}
