import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Star } from "lucide-react";

export default function SubscriptionsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Subscriptions</h1>
          <p className="text-text-secondary mt-1">Manage subscription plans</p>
        </div>
        <Button><Plus className="h-4 w-4 mr-2" />New Plan</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { slug: "weekly", name: "Weekly Clean", price: "$130/week", published: true, features: 4 },
          { slug: "fortnightly", name: "Fortnightly Clean", price: "$150/fortnight", published: true, features: 4 },
          { slug: "monthly", name: "Monthly Clean", price: "$200/month", published: true, features: 4 },
          { slug: "airbnb", name: "Airbnb Hosting", price: "$120/turnover", published: true, features: 4 },
        ].map((plan) => (
          <Card key={plan.slug} variant="outlined">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{plan.name}</CardTitle>
                {plan.published ? <Badge variant="success">Published</Badge> : <Badge variant="neutral">Draft</Badge>}
              </div>
              <CardDescription>{plan.price}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-text-tertiary">{plan.features} features</p>
              <Button variant="outline" size="sm" className="mt-3 w-full">Edit Plan</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
