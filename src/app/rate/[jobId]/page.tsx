import { format } from "date-fns";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { buildRatingToken } from "@/lib/client/ratings";
import { RatingForm } from "./rating-form";

export const dynamic = "force-dynamic";

export default async function PublicRatingPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ jobId }, sp] = await Promise.all([params, searchParams]);
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobType: true,
      scheduledDate: true,
      property: { select: { name: true, clientId: true } },
      satisfactionRating: { select: { score: true, comment: true } },
    },
  });
  if (!job?.id || !job.property?.clientId) notFound();

  const token = typeof sp.token === "string" ? sp.token.trim() : "";
  const valid = token.length > 0 && token === buildRatingToken(job.id, job.property.clientId);

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-900 to-brand-700 px-4 py-12">
      <div className="mx-auto max-w-2xl rounded-2xl bg-white p-8 shadow-2xl">
        <h1 className="text-3xl font-bold text-brand-900">Rate your clean</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {job.property.name} • {String(job.jobType).replace(/_/g, " ")} •{" "}
          {format(new Date(job.scheduledDate), "dd MMM yyyy")}
        </p>
        <hr className="my-6 border-border" />
        <RatingForm
          jobId={job.id}
          token={token}
          valid={valid}
          initialScore={job.satisfactionRating?.score ?? null}
          initialComment={job.satisfactionRating?.comment ?? ""}
        />
      </div>
    </div>
  );
}