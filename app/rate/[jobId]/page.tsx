import { format } from "date-fns";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { buildRatingToken } from "@/lib/client/ratings";
import { RatingPage } from "@/components/public/rating-page";

export default async function PublicRatingPage({
  params,
  searchParams,
}: {
  params: { jobId: string };
  searchParams: { token?: string };
}) {
  const job = await db.job.findUnique({
    where: { id: params.jobId },
    select: {
      id: true,
      jobType: true,
      scheduledDate: true,
      property: { select: { name: true, clientId: true } },
      satisfactionRating: { select: { score: true, comment: true } },
    },
  });

  if (!job?.id || !job.property?.clientId) {
    notFound();
  }

  const token = typeof searchParams?.token === "string" ? searchParams.token.trim() : "";
  const valid = token.length > 0 && token === buildRatingToken(job.id, job.property.clientId);

  return (
    <RatingPage
      jobId={job.id}
      token={token}
      valid={valid}
      propertyName={job.property.name}
      serviceLabel={job.jobType.replace(/_/g, " ")}
      scheduledDateLabel={format(new Date(job.scheduledDate), "dd MMM yyyy")}
      initialScore={job.satisfactionRating?.score ?? null}
      initialComment={job.satisfactionRating?.comment ?? ""}
    />
  );
}
