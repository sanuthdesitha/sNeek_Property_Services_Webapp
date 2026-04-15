import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ShieldAlert, ArrowLeft } from "lucide-react";

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-warning-50 dark:bg-warning-900/30">
          <ShieldAlert className="h-8 w-8 text-warning-600" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">Access Denied</h1>
        <p className="mt-2 text-text-secondary">
          You don&apos;t have permission to access this page. If you believe this is an error, please contact your administrator.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button variant="outline" asChild>
            <Link href="/">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go Home
            </Link>
          </Button>
          <Button asChild>
            <Link href="/login">Sign In</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
