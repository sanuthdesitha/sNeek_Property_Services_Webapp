import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { User, Mail, Phone, DollarSign, Building2 } from "lucide-react";

export default function CleanerProfilePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Profile</h1>
        <p className="text-text-secondary mt-1">Manage your personal information</p>
      </div>

      <Card variant="outlined">
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarFallback className="text-lg bg-brand-100 text-brand-700">JC</AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-lg font-semibold">John Cleaner</h2>
              <p className="text-sm text-text-tertiary">Cleaner &middot; $32/hr</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Personal Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input label="Full Name" defaultValue="John Cleaner" leftIcon={<User className="h-4 w-4" />} />
          <Input label="Email" type="email" defaultValue="cleaner@sneekops.com.au" leftIcon={<Mail className="h-4 w-4" />} disabled />
          <Input label="Phone" type="tel" defaultValue="+61400000003" leftIcon={<Phone className="h-4 w-4" />} />
          <Input label="Hourly Rate" type="number" defaultValue="32" leftIcon={<DollarSign className="h-4 w-4" />} disabled />
          <Separator />
          <h3 className="text-sm font-medium">Bank Details</h3>
          <Input label="BSB" placeholder="062-000" />
          <Input label="Account Number" placeholder="12345678" />
          <Input label="Account Name" placeholder="John Cleaner" />
          <Button>Save Changes</Button>
        </CardContent>
      </Card>
    </div>
  );
}
