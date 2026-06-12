import { redirect } from "next/navigation";

// The standalone ping list was folded into the full live operations map.
export default function LiveMapRedirect() {
  redirect("/admin/ops/map");
}
