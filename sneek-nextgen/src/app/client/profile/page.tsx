import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { User, Mail, Phone } from "lucide-react";

export default function ClientProfilePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Profile</h1>
        <p className="text-text-secondary mt-1">Manage your account details</p>
      </div>

      <Card variant="outlined">
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16"><AvatarFallback className="text-lg bg-brand-100 text-brand-700">SC</AvatarFallback></Avatar>
            <div>
              <h2 className="text-lg font-semibold">Sarah Client</h2>
              <p className="text-sm text-text-tertiary">Client &middot; Harbour Properties Pty Ltd</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader><CardTitle className="text-base">Personal Information</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Input label="Full Name" defaultValue="Sarah Client" leftIcon={<User className="h-4 w-4" />} />
          <Input label="Email" type="email" defaultValue="client@sneekops.com.au" leftIcon={<Mail className="h-4 w-4" />} disabled />
          <Input label="Phone" type="tel" defaultValue="+61400000004" leftIcon={<Phone className="h-4 w-4" />} />
          <Button>Save Changes</Button>
        </CardContent>
      </Card>
    </div>
  );
}
