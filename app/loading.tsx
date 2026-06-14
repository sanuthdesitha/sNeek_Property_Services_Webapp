import { BrandLoader } from "@/components/ui/brand-loader";

/**
 * Root route-segment loading UI. The root route ("/") is the public marketing
 * home, so this loader wears the luxury / Cormorant-serif marketing surface —
 * warm ivory tokens + serif wordmark — to match the public site's elegance.
 * (Portal segments have their own loading.tsx on the standard token theme.)
 */
export default function RootLoading() {
  return (
    <div
      className="marketing-only flex min-h-screen w-full items-center justify-center"
      data-portal-theme="public"
    >
      <BrandLoader surface="public" />
    </div>
  );
}
