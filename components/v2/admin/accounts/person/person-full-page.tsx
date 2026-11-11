"use client";

/**
 * The full account page (`/v2/admin/accounts/users/[id]`): the same sections
 * as the panel, laid out with more room, plus the header actions. After a
 * change the server data is re-read (router.refresh), so the page always
 * shows what was saved.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import type { PersonCapabilities, PersonProfile } from "@/lib/accounts/person-types";
import { Avatar, StatusPill, formatMonthYear } from "../hub/account-display";
import { PersonActions } from "./person-actions";
import { PersonPageView } from "./person-view";

export function PersonFullPage({ profile, caps }: { profile: PersonProfile; caps: PersonCapabilities }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <EButton asChild variant="ghost" size="icon">
          <Link href={`/v2/admin/accounts?open=${encodeURIComponent(profile.id)}`} aria-label="Back to accounts">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </EButton>
        <Link href="/v2/admin/accounts" className="text-[0.75rem] text-[hsl(var(--e-text-faint))] hover:underline">Accounts</Link>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={profile.name} email={profile.email} size={48} />
          <div className="min-w-0">
            <h1 className="e-display-md break-words">{profile.name ?? profile.email}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {profile.roleLabel} · since {formatMonthYear(profile.hireDate ?? profile.createdAt)}
              <StatusPill status={profile.status} inviteAgeDays={profile.inviteAgeDays} />
              {profile.extraRoles.map((extra) => <EPill key={extra.role} tone="gold">{extra.label}</EPill>)}
              {profile.employmentType ? <EPill>{profile.employmentType.replace(/_/g, " ").toLowerCase()}</EPill> : null}
              {profile.birthday ? <span>· Birthday {profile.birthday.date}{profile.birthday.age !== null ? ` (${profile.birthday.age})` : ""}</span> : null}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {profile.isFieldRole ? (
            <EButton asChild variant="outline" size="sm">
              <Link href={`/v2/admin/workforce/performance/${profile.id}`}>Full performance</Link>
            </EButton>
          ) : null}
          <PersonActions profile={profile} caps={caps} onChanged={() => router.refresh()} onDeleted={() => router.push("/v2/admin/accounts")} />
        </div>
      </header>
      <PersonPageView profile={profile} caps={caps} onChanged={() => router.refresh()} />
    </div>
  );
}
