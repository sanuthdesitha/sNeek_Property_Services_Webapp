import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Megaphone, Tag } from "lucide-react";

export default function MarketingPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Marketing</h1>
          <p className="text-text-secondary mt-1">Email campaigns and discount codes</p>
        </div>
      </div>

      <Tabs defaultValue="campaigns">
        <TabsList>
          <TabsTrigger value="campaigns">Email Campaigns</TabsTrigger>
          <TabsTrigger value="discounts">Discount Codes</TabsTrigger>
          <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns" className="space-y-4">
          <div className="flex justify-end">
            <Button asChild>
              <Link href="/admin/marketing/campaigns/new">
                <Plus className="h-4 w-4 mr-2" />
                New Campaign
              </Link>
            </Button>
          </div>
          <Card variant="outlined">
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Recipients</TableHead>
                    <TableHead>Sent</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { name: "Spring Cleaning Promo", subject: "Get 15% off your next clean!", status: "sent", recipients: 120, sent: "2026-04-10" },
                    { name: "New Service Launch", subject: "Introducing our Carpet Steam Clean", status: "draft", recipients: 0, sent: null },
                  ].map((campaign, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-sm flex items-center gap-2">
                        <Megaphone className="h-4 w-4 text-text-tertiary" />
                        {campaign.name}
                      </TableCell>
                      <TableCell className="text-sm">{campaign.subject}</TableCell>
                      <TableCell><Badge variant={campaign.status === "sent" ? "success" : "neutral"}>{campaign.status}</Badge></TableCell>
                      <TableCell className="text-sm">{campaign.recipients}</TableCell>
                      <TableCell className="text-sm">{campaign.sent ?? "—"}</TableCell>
                      <TableCell><Button variant="ghost" size="sm">View</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="discounts" className="space-y-4">
          <div className="flex justify-end">
            <Button asChild>
              <Link href="/admin/marketing/discounts/new">
                <Plus className="h-4 w-4 mr-2" />
                New Discount
              </Link>
            </Button>
          </div>
          <Card variant="outlined">
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Usage</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { code: "SPRING15", title: "Spring Cleaning 15% Off", type: "PERCENT", value: 15, usage: "12/50", active: true },
                    { code: "WELCOME10", title: "New Client Welcome", type: "PERCENT", value: 10, usage: "5/100", active: true },
                    { code: "DEEP50", title: "$50 Off Deep Clean", type: "FIXED", value: 50, usage: "0/20", active: false },
                  ].map((discount, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-sm flex items-center gap-2">
                        <Tag className="h-4 w-4 text-text-tertiary" />
                        {discount.code}
                      </TableCell>
                      <TableCell className="text-sm">{discount.title}</TableCell>
                      <TableCell className="text-sm">{discount.type}</TableCell>
                      <TableCell className="text-sm">{discount.type === "PERCENT" ? `${discount.value}%` : `$${discount.value}`}</TableCell>
                      <TableCell className="text-sm">{discount.usage}</TableCell>
                      <TableCell>{discount.active ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Inactive</Badge>}</TableCell>
                      <TableCell><Button variant="ghost" size="sm">Edit</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="subscriptions">
          <Card variant="outlined">
            <CardContent className="pt-6 text-center text-text-secondary">
              <p>Manage subscription plans in Settings &gt; Subscription Plans</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
