import { NewJobForm } from "@/components/admin/new-job-form";

export default function NewJobPage({ searchParams }: { searchParams: { propertyId?: string } }) {
  return <NewJobForm initialPropertyId={searchParams.propertyId} />;
}
