import Link from "next/link";
import { db } from "@/lib/db";
import { EButton } from "@/components/v2/ui/primitives";
import { AuthFrame } from "@/components/v2/public/auth-frame";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { token: string };
}

/**
 * Invitation link (board "Public and sign in", screens 2 and 7). The checks and
 * their order are unchanged: not recognised, already accepted, expired, account
 * unavailable, then the set-password form. Every broken link says exactly why
 * and offers one button: Go to sign in.
 */
function InviteProblem({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <AuthFrame eyebrow={eyebrow} title={title} intro={<p>{body}</p>}>
      <EButton asChild variant="gold" size="lg" className="w-full">
        <Link href="/login">Go to sign in</Link>
      </EButton>
    </AuthFrame>
  );
}

export default async function AcceptInvitePage({ params }: PageProps) {
  const invite = await db.userInvitation.findUnique({
    where: { token: params.token },
    include: {
      user: { select: { id: true, email: true, name: true, role: true, isActive: true } },
    },
  });

  if (!invite) {
    return (
      <InviteProblem
        eyebrow="Not recognised"
        title="Invalid invitation"
        body="This invitation link is not recognised. Ask the office to send a new one."
      />
    );
  }

  if (invite.acceptedAt) {
    return (
      <InviteProblem
        eyebrow="Used"
        title="Already accepted"
        body="This invitation has already been used. If that was you, sign in."
      />
    );
  }

  if (invite.expiresAt.getTime() < Date.now()) {
    return (
      <InviteProblem
        eyebrow="Expired"
        title="Invitation expired"
        body="This invitation has expired. Ask the office to send a new one."
      />
    );
  }

  if (!invite.user.isActive) {
    return (
      <InviteProblem
        eyebrow="Not available"
        title="Account unavailable"
        body="This account is no longer active. Contact the office for help."
      />
    );
  }

  return (
    <AcceptInviteForm
      token={params.token}
      user={{
        email: invite.user.email,
        name: invite.user.name,
        role: invite.user.role,
      }}
      expiresAt={invite.expiresAt.toISOString()}
    />
  );
}
