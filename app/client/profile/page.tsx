import { redirect } from "next/navigation";

export default async function ClientProfilePage() {
  redirect("/client/settings");
}
