import { redirect } from "next/navigation";

export default function PaymentGatewaysRedirectPage() {
  redirect("/admin/settings?tab=payment-gateways");
}
