import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShoppingCart, Send, MessageSquare } from "lucide-react";

export default function ClientMessagesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Messages</h1>
        <p className="text-text-secondary mt-1">Chat with the admin team</p>
      </div>

      <Card variant="outlined">
        <CardContent className="pt-4">
          <div className="h-64 flex items-center justify-center text-text-tertiary rounded-lg bg-neutral-50 dark:bg-neutral-900 mb-4">
            <div className="text-center">
              <MessageSquare className="h-8 w-8 mx-auto mb-2" />
              <p className="text-sm">Select a conversation to start chatting</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder="Type a message..." className="flex-1" />
            <Button><Send className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}