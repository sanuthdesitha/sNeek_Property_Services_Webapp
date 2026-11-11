import Link from "next/link";
import { EPageHeader, ECard, ECardBody } from "@/components/v2/ui/primitives";

const COPY = {
  feature: {
    title: "Feature access is turned off",
    description:
      "Your operations-manager permission pack does not include this feature. Ask an administrator to review your access in Settings → Access → Roles.",
  },
  role: {
    title: "This page is for administrators",
    description:
      "Your account does not include this page. It is limited to administrators and cannot be granted through a permission pack.",
  },
};

export default function AccessDeniedPage({
  searchParams,
}: {
  searchParams?: { reason?: string };
}) {
  const copy = searchParams?.reason === "role" ? COPY.role : COPY.feature;
  return (
    <div className="space-y-6">
      <EPageHeader title={copy.title} description={copy.description} />
      <ECard>
        <ECardBody className="pt-6">
          <p className="mb-4">
            Choose an available feature from the navigation, or return to your
            profile.
          </p>
          <Link
            href="/v2/admin/profile"
            className="inline-flex min-h-11 items-center underline"
          >
            Open my profile
          </Link>
        </ECardBody>
      </ECard>
    </div>
  );
}
