import Link from "next/link";
import { db } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { token: string };
}

export default async function AcceptInvitePage({ params }: PageProps) {
  const invite = await db.userInvitation.findUnique({
    where: { token: params.token },
    include: {
      user: { select: { id: true, email: true, name: true, role: true, isActive: true } },
    },
  });

  const wrapper = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );

  if (!invite) {
    return wrapper(
      <Card>
        <CardHeader>
          <CardTitle>Invalid invitation</CardTitle>
          <CardDescription>
            This invitation link is not recognized. Ask an administrator to send a new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Go to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (invite.acceptedAt) {
    return wrapper(
      <Card>
        <CardHeader>
          <CardTitle>Invitation already accepted</CardTitle>
          <CardDescription>
            This invitation has already been used. If that was you, just sign in below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/login">Go to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (invite.expiresAt.getTime() < Date.now()) {
    return wrapper(
      <Card>
        <CardHeader>
          <CardTitle>Invitation expired</CardTitle>
          <CardDescription>
            This invitation has expired. Ask an administrator to send a new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Go to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!invite.user.isActive) {
    return wrapper(
      <Card>
        <CardHeader>
          <CardTitle>Account unavailable</CardTitle>
          <CardDescription>
            This account is no longer active. Contact an administrator for help.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Go to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return wrapper(
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
