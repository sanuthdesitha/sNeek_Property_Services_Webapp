import { redirect } from "next/navigation";

export default async function LaundryProfilePage() {
  redirect("/laundry/settings");
}
