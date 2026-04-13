import { redirect } from "next/navigation";

export default function XeroRedirectPage() {
  redirect("/admin/settings?tab=xero");
}
