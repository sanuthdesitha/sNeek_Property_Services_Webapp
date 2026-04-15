import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Search, Mail, Phone, Key } from "lucide-react";

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Users & Team</h1>
          <p className="text-text-secondary mt-1">Manage all users and team members</p>
        </div>
        <Button asChild>
          <Link href="/admin/users/new">
            <Plus className="h-4 w-4 mr-2" />
            Add User
          </Link>
        </Button>
      </div>

      <Card variant="outlined">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-48">
              <Input placeholder="Search users..." leftIcon={<Search className="h-4 w-4" />} />
            </div>
            <Select
              options={[
                { value: "", label: "All Roles" },
                { value: "ADMIN", label: "Admin" },
                { value: "OPS_MANAGER", label: "Ops Manager" },
                { value: "CLEANER", label: "Cleaner" },
                { value: "CLIENT", label: "Client" },
                { value: "LAUNDRY", label: "Laundry" },
              ]}
              placeholder="Role"
            />
          </div>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">All Users</CardTitle>
          <CardDescription>5 users in the system</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { name: "Admin User", email: "admin@sneekops.com.au", phone: "+61400000001", role: "ADMIN", rate: null, active: true },
                { name: "Ops Manager", email: "ops@sneekops.com.au", phone: "+61400000002", role: "OPS_MANAGER", rate: null, active: true },
                { name: "John Cleaner", email: "cleaner@sneekops.com.au", phone: "+61400000003", role: "CLEANER", rate: 32, active: true },
                { name: "Sarah Client", email: "client@sneekops.com.au", phone: "+61400000004", role: "CLIENT", rate: null, active: true },
                { name: "Laundry Service", email: "laundry@sneekops.com.au", phone: "+61400000005", role: "LAUNDRY", rate: null, active: true },
              ].map((user) => (
                <TableRow key={user.email}>
                  <TableCell className="font-medium text-sm">{user.name}</TableCell>
                  <TableCell className="text-sm flex items-center gap-1">
                    <Mail className="h-3 w-3 text-text-tertiary" />
                    {user.email}
                  </TableCell>
                  <TableCell className="text-sm flex items-center gap-1">
                    <Phone className="h-3 w-3 text-text-tertiary" />
                    {user.phone}
                  </TableCell>
                  <TableCell><Badge variant="neutral">{user.role.replace("_", " ")}</Badge></TableCell>
                  <TableCell className="text-sm">{user.rate ? `$${user.rate}/hr` : "—"}</TableCell>
                  <TableCell>{user.active ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Inactive</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/admin/users/${user.email.split("@")[0]}`}>Edit</Link>
                      </Button>
                      <Button variant="ghost" size="sm"><Key className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
