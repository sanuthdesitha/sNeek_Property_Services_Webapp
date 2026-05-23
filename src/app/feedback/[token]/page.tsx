import { format } from "date-fns";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { FeedbackForm } from "./feedback-form";

export const dynamic = "force-dynamic";

export default async function PublicFeedbackPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const feedback = await db.jobFeedback.findUnique({
    where: { token },
    select: {
      token: true,
      rating: true,
      comment: true,
      tokenExpiresAt: true,
      job: {
        select: {
          id: true,
          jobType: true,
          scheduledDate: true,
          property: { select: { name: true } },
        },
      },
    },
  });
  if (!feedback?.job?.id) notFound();

  const valid = new Date(feedback.tokenExpiresAt).getTime() > Date.now();

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-900 to-brand-700 px-4 py-12">
      <div className="mx-auto max-w-2xl rounded-2xl bg-white p-8 shadow-2xl">
        <h1 className="text-3xl font-bold text-brand-900">Share your feedback</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {feedback.job.property.name} • {String(feedback.job.jobType).replace(/_/g, " ")} •{" "}
          {format(new Date(feedback.job.scheduledDate), "dd MMM yyyy")}
        </p>
        <hr className="my-6 border-border" />
        <FeedbackForm
          token={feedback.token}
          valid={valid}
          initialRating={feedback.rating ?? null}
          initialComment={feedback.comment ?? ""}
        />
      </div>
    </div>
  );
}