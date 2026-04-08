import { format } from "date-fns";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { FeedbackPage } from "@/components/public/feedback-page";

export default async function PublicFeedbackPage({
  params,
}: {
  params: { token: string };
}) {
  const feedback = await db.jobFeedback.findUnique({
    where: { token: params.token },
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
    <FeedbackPage
      token={feedback.token}
      valid={valid}
      propertyName={feedback.job.property.name}
      serviceLabel={feedback.job.jobType.replace(/_/g, " ")}
      scheduledDateLabel={format(new Date(feedback.job.scheduledDate), "dd MMM yyyy")}
      initialRating={feedback.rating ?? null}
      initialComment={feedback.comment ?? ""}
    />
  );
}
