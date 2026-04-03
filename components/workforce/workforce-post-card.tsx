"use client";

import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";

function formatPostDate(value: string | Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function initialsFromName(value?: string | null) {
  return (value || "Team")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function WorkforcePostCard({
  post,
  className = "",
}: {
  post: {
    id: string;
    type?: string;
    title: string;
    body: string;
    pinned?: boolean;
    coverImageUrl?: string | null;
    attachments?: Array<{
      url: string;
      fileName?: string | null;
      mimeType?: string | null;
      label?: string | null;
    }>;
    isUnread?: boolean;
    seenCount?: number;
    createdAt: string | Date;
    createdBy?: { name?: string | null; image?: string | null } | null;
  };
  className?: string;
}) {
  const authorName = post.createdBy?.name || "Team update";

  return (
    <article className={`overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_18px_46px_rgba(15,23,42,0.08)] ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {post.createdBy?.image ? (
            <img src={post.createdBy.image} alt={authorName} className="h-11 w-11 rounded-full object-cover ring-2 ring-white shadow-sm" />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 via-teal-500 to-sky-500 text-sm font-semibold text-white shadow-sm">
              {initialsFromName(authorName)}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{authorName}</p>
            <p className="truncate text-xs text-slate-500">{formatPostDate(post.createdAt)}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {post.isUnread ? <span className="h-2.5 w-2.5 rounded-full bg-sky-500" aria-hidden /> : null}
          {post.pinned ? <Badge variant="warning">Pinned</Badge> : null}
          {post.type === "RECOGNITION" ? (
            <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">
              <Sparkles className="mr-1 h-3 w-3" />
              Recognition
            </Badge>
          ) : (
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
              Update
            </Badge>
          )}
        </div>
      </div>

      {post.coverImageUrl ? (
        <div className="bg-[radial-gradient(circle_at_top_left,rgba(255,213,128,0.28),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(45,212,191,0.28),transparent_36%)] px-4 pt-4">
          <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-slate-100 shadow-inner">
            <img
              src={post.coverImageUrl}
              alt={post.title}
              className="aspect-[4/5] w-full object-cover sm:aspect-[16/10]"
            />
          </div>
        </div>
      ) : null}

      <div className="space-y-3 px-4 pb-5 pt-4">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-slate-950">{post.title}</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{post.body}</p>
        </div>
        {(post.attachments?.length ?? 0) > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {post.attachments!.map((attachment) => {
              const isImage = attachment.mimeType?.startsWith("image/");
              return (
                <a
                  key={`${attachment.url}-${attachment.fileName ?? ""}`}
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 transition hover:border-primary/40 hover:bg-primary/5"
                >
                  {isImage ? (
                    <img
                      src={attachment.url}
                      alt={attachment.label || attachment.fileName || post.title}
                      className="aspect-[4/3] w-full object-cover"
                    />
                  ) : null}
                  <div className="p-3">
                    <p className="line-clamp-1 text-sm font-medium text-slate-900">{attachment.label || attachment.fileName || "Attachment"}</p>
                    <p className="mt-1 text-xs text-slate-500">{isImage ? "Open image" : attachment.mimeType || "Open file"}</p>
                  </div>
                </a>
              );
            })}
          </div>
        ) : null}
        {typeof post.seenCount === "number" ? (
          <p className="text-xs text-slate-500">Seen by {post.seenCount} staff</p>
        ) : null}
      </div>
    </article>
  );
}
