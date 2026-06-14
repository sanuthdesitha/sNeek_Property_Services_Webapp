import { BrandLoader } from "@/components/ui/brand-loader";

/** Branded loader for the admin portal (standard token theme). */
export default function AdminLoading() {
  return <BrandLoader surface="portal" label="Loading admin" />;
}
