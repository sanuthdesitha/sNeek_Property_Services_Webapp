import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/constants";
import { VerifyCodeForm } from "@/components/public/verify-code-form";

// Deliberately NOT gated by requireWebsitePageEnabled: codes are printed on
// issued reports, so this page must always resolve.

export const metadata: Metadata = {
  title: "Verify a cleaning report",
  description:
    "Enter the verification code from a cleaning report to confirm it is genuine.",
};

export default function VerifyPage() {
  return (
    <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
      <div className="public-page-frame">
        <div className="max-w-2xl space-y-4">
          <p className="marketing-eyebrow">Report verification</p>
          <h1 className="text-4xl font-semibold">Verify a cleaning report</h1>
          <p className="text-base leading-8 text-muted-foreground">
            Every report we issue carries a unique verification code. Enter the code from the
            report (or scan its QR) to confirm the clean was genuinely performed and recorded by
            us.
          </p>
        </div>

        <Card className="mt-8 max-w-2xl rounded-[2rem] border-white/70 bg-white/80 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.34)]">
          <CardContent className="p-6">
            <VerifyCodeForm />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
