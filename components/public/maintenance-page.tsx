import Link from "next/link";
import { Wrench, ShieldAlert, MessageSquare, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/constants";
import type { WebsiteContent } from "@/lib/public-site/content";
import { ADMIN_RECOVERY_LOGIN_URL } from "@/lib/public-site/routing";

export function MaintenancePage({ content }: { content: WebsiteContent }) {
  return (
    <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
      <div className="mx-auto grid w-full max-w-4xl gap-6">
        <Card className="rounded-[2rem] border-white/70 bg-white/88 shadow-[0_24px_70px_-36px_rgba(22,63,70,0.38)]">
          <CardContent className="grid gap-6 p-8 md:grid-cols-[auto_1fr] md:items-start">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Wrench className="h-6 w-6" />
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Website maintenance</p>
                <h1 className="text-3xl font-semibold sm:text-4xl">{content.maintenanceMode.message}</h1>
                <p className="text-sm leading-7 text-muted-foreground sm:text-base sm:leading-8">
                  {content.maintenanceMode.supportMessage}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                {content.maintenanceMode.allowLogin ? (
                  <Button asChild className="rounded-full">
                    <Link href="/login">Portal login</Link>
                  </Button>
                ) : (
                  <Button asChild variant="secondary" className="rounded-full">
                    <Link href={ADMIN_RECOVERY_LOGIN_URL}>
                      <ShieldAlert className="mr-2 h-4 w-4" />
                      Admin recovery login
                    </Link>
                  </Button>
                )}
                <Button asChild variant="outline" className="rounded-full">
                  <Link href="/contact">
                    <MessageSquare className="mr-2 h-4 w-4" />
                    Contact the team
                  </Link>
                </Button>
                <Button asChild variant="outline" className="rounded-full">
                  <a href={`tel:${(content.contact.displayPhone || "+61 451 217 210").replace(/\s+/g, "")}`}>
                    <Phone className="mr-2 h-4 w-4" />
                    Call now
                  </a>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

