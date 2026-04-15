import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { KeyRound } from "lucide-react";

export default function ForcePasswordResetPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardContent className="pt-6">
          <div className="text-center mb-6">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600">
              <KeyRound className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-text-primary">Reset Your Password</h1>
            <p className="text-text-secondary mt-1">Please set a new password for your account</p>
          </div>
          <form className="space-y-4">
            <Input label="New Password" type="password" placeholder="Min 8 characters" minLength={8} />
            <Input label="Confirm New Password" type="password" placeholder="Re-enter password" />
            <Button type="submit" className="w-full">Reset Password</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
