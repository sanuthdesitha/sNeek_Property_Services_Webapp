import { BrandLoader } from "@/components/ui/brand-loader";

/** Branded loader for the client portal (standard token theme). */
export default function ClientLoading() {
  return <BrandLoader surface="portal" label="Loading client portal" />;
}
