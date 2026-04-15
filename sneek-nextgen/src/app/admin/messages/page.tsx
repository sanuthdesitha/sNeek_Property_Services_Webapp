import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Send, MessageSquare } from "lucide-react";

export default function MessagesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Messages</h1>
        <p className="text-text-secondary mt-1">Client messages and chat channels</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Conversations list */}
        <Card variant="outlined">
          <CardHeader>
            <CardTitle className="text-base">Conversations</CardTitle>
          </CardHeader>
          <CardContent>
            <Input placeholder="Search..." leftIcon={<Search className="h-4 w-4" />} className="mb-4" />
            <div className="space-y-2">
              {[
                { name: "Harbour Properties", lastMessage: "When is the next clean scheduled?", unread: 2, time: "10 min ago" },
                { name: "Beach Rentals Co", lastMessage: "Thanks for the quick turnaround!", unread: 0, time: "2 hours ago" },
                { name: "City Apartments", lastMessage: "Can we reschedule to next week?", unread: 1, time: "1 day ago" },
              ].map((conv, i) => (
                <div
                  key={i}
                  className="p-3 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-900 cursor-pointer transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm">{conv.name}</p>
                    {conv.unread > 0 && <Badge variant="info">{conv.unread}</Badge>}
                  </div>
                  <p className="text-xs text-text-tertiary truncate mt-0.5">{conv.lastMessage}</p>
                  <p className="text-xs text-text-tertiary mt-0.5">{conv.time}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Chat area */}
        <Card variant="outlined" className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Harbour Properties</CardTitle>
            <CardDescription>Client messages</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 flex items-center justify-center text-text-tertiary mb-4 rounded-lg bg-neutral-50 dark:bg-neutral-900">
              <div className="text-center">
                <MessageSquare className="h-8 w-8 mx-auto mb-2" />
                <p className="text-sm">Select a conversation to start chatting</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input placeholder="Type a message..." className="flex-1" />
              <Button>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
