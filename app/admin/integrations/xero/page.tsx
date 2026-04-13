import { redirect } from "next/navigation";

export default function XeroRedirectPage(props: { searchParams: Record<string, string> }) {
  const params = new URLSearchParams();
  if (props.searchParams.connected) params.set("connected", props.searchParams.connected);
  if (props.searchParams.tenant) params.set("tenant", props.searchParams.tenant);
  if (props.searchParams.error) params.set("error", props.searchParams.error);
  const qs = params.toString();
  redirect(`/admin/settings?tab=xero${qs ? `&${qs}` : ""}`);
}
