import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { User, Mail, Phone, Key } from "lucide-react";

export default function ProfilePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Profile</h1>
        <p className="text-text-secondary mt-1">Manage your personal settings</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile card */}
        <Card variant="outlined">
          <CardContent className="pt-6 text-center">
            <Avatar className="h-20 w-20 mx-auto mb-4">
              <AvatarFallback className="text-lg bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-300">AU</AvatarFallback>
            </Avatar>
            <h2 className="text-lg font-semibold">Admin User</h2>
            <p className="text-sm text-text-tertiary">admin@sneekops.com.au</p>
            <p className="text-xs text-text-tertiary mt-1">ADMIN role</p>
          </CardContent>
        </Card>

        {/* Edit form */}
        <Card variant="outlined" className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Personal Information</CardTitle>
            <CardDescription>Update your profile details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input label="Full Name" defaultValue="Admin User" leftIcon={<User className="h-4 w-4" />} />
            <Input label="Email" type="email" defaultValue="admin@sneekops.com.au" leftIcon={<Mail className="h-4 w-4" />} disabled />
            <Input label="Phone" type="tel" defaultValue="+61400000001" leftIcon={<Phone className="h-4 w-4" />} />
            <Separator />
            <h3 className="text-sm font-medium">Change Password</h3>
            <Input label="Current Password" type="password" leftIcon={<Key className="h-4 w-4" />} />
            <Input label="New Password" type="password" />
            <Input label="Confirm New Password" type="password" />
            <Button>Save Changes</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
