import { NewPropertyForm } from "@/components/admin/new-property-form";

export default function NewPropertyPage({
  searchParams,
}: {
  searchParams: { clientId?: string; copyFrom?: string };
}) {
  return (
    <NewPropertyForm
      initialClientId={searchParams.clientId}
      copyFromPropertyId={searchParams.copyFrom}
    />
  );
}
