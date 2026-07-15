import { LaundryWorkspace } from "@/components/v2/admin/laundry/laundry-workspace";

export const metadata = { title: "Laundry · Estate admin" };
export const dynamic = "force-dynamic";

export default function AdminLaundryPage() {
  return <LaundryWorkspace />;
}
