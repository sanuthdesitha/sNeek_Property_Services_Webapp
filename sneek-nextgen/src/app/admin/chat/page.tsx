import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, MessageSquare, Users } from "lucide-react";

export default function ChatChannelsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Chat Channels</h1>
          <p className="text-text-secondary mt-1">Manage team chat channels</p>
        </div>
        <Button><Plus className="h-4 w-4 mr-2" />New Channel</Button>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">All Channels</CardTitle>
          <CardDescription>Team chat channels</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Last Activity</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { name: "General", type: "GROUP", members: 12, lastActivity: "5 min ago" },
                { name: "Cleaners Only", type: "GROUP", members: 8, lastActivity: "1 hour ago" },
                { name: "Ops Team", type: "GROUP", members: 3, lastActivity: "2 hours ago" },
              ].map((channel, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium text-sm flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-text-tertiary" />
                    {channel.name}
                  </TableCell>
                  <TableCell className="text-sm">{channel.type}</TableCell>
                  <TableCell className="text-sm flex items-center gap-1"><Users className="h-3 w-3 text-text-tertiary" />{channel.members}</TableCell>
                  <TableCell className="text-sm text-text-tertiary">{channel.lastActivity}</TableCell>
                  <TableCell><Button variant="ghost" size="sm">Open</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
