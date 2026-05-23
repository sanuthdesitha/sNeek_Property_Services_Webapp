import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ApplyForm } from "./apply-form";

export const dynamic = "force-dynamic";

export default async function ApplyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const position = await db.hiringPosition.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      department: true,
      location: true,
      employmentType: true,
      isPublished: true,
      applicationSchema: true,
    },
  });
  if (!position || !position.isPublished) notFound();

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-900 to-brand-700 px-4 py-16">
      <div className="mx-auto max-w-2xl rounded-2xl bg-white p-8 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-600">Apply</p>
        <h1 className="mt-2 text-3xl font-bold text-brand-900">{position.title}</h1>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {position.department && <span>{position.department}</span>}
          {position.location && <span>· {position.location}</span>}
          {position.employmentType && <span>· {position.employmentType}</span>}
        </div>
        <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-gray-600">{position.description}</p>
        <hr className="my-6 border-border" />
        <ApplyForm positionId={position.id} positionTitle={position.title} />
      </div>
    </div>
  );
}