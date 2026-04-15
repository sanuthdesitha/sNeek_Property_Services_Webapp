import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Star, Gift, Copy, Users } from "lucide-react";

export default function ClientReferralsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Referrals & Loyalty</h1>
        <p className="text-text-secondary mt-1">Earn rewards by referring friends</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card variant="outlined">
          <div className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-brand-50 dark:bg-brand-900/30"><Star className="h-5 w-5 text-brand-600" /></div>
            <div><p className="text-sm text-text-secondary">Loyalty Points</p><p className="text-2xl font-bold">250</p></div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-success-50 dark:bg-success-900/30"><Users className="h-5 w-5 text-success-600" /></div>
            <div><p className="text-sm text-text-secondary">Referrals Made</p><p className="text-2xl font-bold">3</p></div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-warning-50 dark:bg-warning-900/30"><Gift className="h-5 w-5 text-warning-600" /></div>
            <div><p className="text-sm text-text-secondary">Rewards Earned</p><p className="text-2xl font-bold">$75</p></div>
          </div>
        </Card>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Your Referral Code</CardTitle>
          <CardDescription>Share this code with friends to earn rewards</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <code className="text-lg font-mono bg-neutral-100 dark:bg-neutral-800 px-4 py-2 rounded-lg">SNEEK-HARBOUR-2026</code>
            <Button variant="outline" size="sm"><Copy className="h-4 w-4 mr-1" />Copy</Button>
          </div>
          <p className="text-xs text-text-tertiary mt-3">Your friend gets 10% off their first clean. You earn 50 loyalty points per referral.</p>
        </CardContent>
      </Card>
    </div>
  );
}
