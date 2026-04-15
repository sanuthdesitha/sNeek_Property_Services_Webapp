"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  CheckCircle,
  XCircle,
  Edit,
  Eye,
  User,
  Building2,
  Plug,
  FileText,
  DollarSign,
  Shirt,
  Package,
  Calendar,
  AlertTriangle,
  CheckSquare,
} from "lucide-react";

const ENTITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  CLIENT: User,
  PROPERTY: Building2,
  INTEGRATION: Plug,
  FORM_TEMPLATE: FileText,
  PRICE_BOOK_ENTRY: DollarSign,
  PROPERTY_CLIENT_RATE: DollarSign,
  JOB_SCHEDULE: Calendar,
  JOB: Calendar,
  INVENTORY_DEFAULT: Package,
  LAUNDRY_SETTING: Shirt,
};

export default function PackageReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const [reviewing, setReviewing] = useState(false);

  // Placeholder data — would be fetched from API
  const pkg = {
    id: "pkg_001",
    status: "SUBMITTED",
    survey: {
      surveyor: { name: "John Cleaner" },
      client: { name: "Harbour Properties Pty Ltd" },
      sections: [
        { sectionKey: "CLIENT", data: { name: "New Client Co", email: "info@newclient.com", phone: "+61400000099" } },
        { sectionKey: "PROPERTY", data: { name: "Beach House", address: "45 Ocean Ave", suburb: "Bondi", bedrooms: 3, bathrooms: 2, hasBalcony: true, laundryEnabled: true } },
        { sectionKey: "SERVICES", data: { primaryType: "AIRBNB_TURNOVER", addonTypes: ["DEEP_CLEAN"], frequency: "fortnightly" } },
      ],
    },
    items: [
      { id: "item_1", entityType: "CLIENT", status: "PENDING", data: { name: "New Client Co", email: "info@newclient.com" } },
      { id: "item_2", entityType: "PROPERTY", status: "PENDING", data: { name: "Beach House", address: "45 Ocean Ave", suburb: "Bondi", bedrooms: 3, bathrooms: 2 } },
      { id: "item_3", entityType: "INTEGRATION", status: "PENDING", data: { provider: "ICAL_HOSPITABLE", icalUrl: "https://ical.hospitable.com/..." } },
      { id: "item_4", entityType: "FORM_TEMPLATE", status: "PENDING", data: { serviceType: "AIRBNB_TURNOVER" } },
      { id: "item_5", entityType: "PRICE_BOOK_ENTRY", status: "PENDING", data: { serviceType: "AIRBNB_TURNOVER" } },
      { id: "item_6", entityType: "PROPERTY_CLIENT_RATE", status: "PENDING", data: { serviceType: "AIRBNB_TURNOVER" } },
      { id: "item_7", entityType: "JOB_SCHEDULE", status: "PENDING", data: { frequency: "fortnightly" } },
      { id: "item_8", entityType: "LAUNDRY_SETTING", status: "PENDING", data: { linenBufferSets: 3 } },
    ],
  };

  const handleApproveAll = async () => {
    setReviewing(true);
    // POST /api/admin/onboarding/packages/[id] with action: APPROVE_ALL
    console.log("Approving all items...");
    setReviewing(false);
  };

  const handleItemAction = async (itemId: string, action: string) => {
    // POST /api/admin/onboarding/packages/[id] with action + itemId
    console.log(`Item ${itemId}: ${action}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Review Onboarding Package</h1>
          <p className="text-text-secondary mt-1">Surveyed by {pkg.survey.surveyor.name} for {pkg.survey.client.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => handleApproveAll()} loading={reviewing}>
            <CheckCircle className="h-4 w-4 mr-2" />
            Approve All
          </Button>
          <Button variant="destructive">
            <XCircle className="h-4 w-4 mr-2" />
            Reject All
          </Button>
        </div>
      </div>

      {/* Conflict warnings */}
      <Alert variant="warning">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Potential Conflicts Detected</AlertTitle>
        <AlertDescription>
          A property already exists at &quot;45 Ocean Ave, Bondi&quot;. Please verify this is a different property or merge with the existing record.
        </AlertDescription>
      </Alert>

      {/* Entity relationship preview */}
      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Entity Relationship Preview</CardTitle>
          <CardDescription>How all entities will be linked after approval</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="info">Client: New Client Co</Badge>
            <span className="text-text-tertiary">→ owns →</span>
            <Badge variant="default">Property: Beach House</Badge>
            <span className="text-text-tertiary">→ has →</span>
            <Badge variant="neutral">iCal Integration</Badge>
            <span className="text-text-tertiary">→ with →</span>
            <Badge variant="success">Airbnb Turnover Template</Badge>
            <span className="text-text-tertiary">→ on →</span>
            <Badge variant="warning">Fortnightly Schedule</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Items to review */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Items to Review ({pkg.items.length})</h2>
        {pkg.items.map((item) => {
          const Icon = ENTITY_ICONS[item.entityType] ?? FileText;
          return (
            <Card key={item.id} variant="outlined">
              <CardContent className="pt-4">
                <div className="flex items-start gap-4">
                  <div className="p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800">
                    <Icon className="h-5 w-5 text-text-secondary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-text-primary">{item.entityType.replace(/_/g, " ")}</h3>
                      <Badge
                        variant={
                          item.status === "APPROVED" ? "success" :
                          item.status === "EDITED" ? "warning" :
                          item.status === "REJECTED" ? "danger" :
                          "neutral"
                        }
                      >
                        {item.status}
                      </Badge>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      {Object.entries(item.data as Record<string, unknown>).slice(0, 4).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-1">
                          <span className="text-text-tertiary">{key}:</span>
                          <span className="text-text-primary truncate">{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => handleItemAction(item.id, "APPROVE_ITEM")}>
                      <CheckSquare className="h-4 w-4 mr-1" />
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleItemAction(item.id, "EDIT_ITEM")}>
                      <Edit className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleItemAction(item.id, "REJECT_ITEM")}>
                      <XCircle className="h-4 w-4 mr-1" />
                      Reject
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
