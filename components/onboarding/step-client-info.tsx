"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

interface ClientOption {
  id: string;
  name: string;
  email: string;
}

interface StepClientInfoProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

export function StepClientInfo({ data, onChange }: StepClientInfoProps) {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [isNewClient, setIsNewClient] = useState(data.isNewClient === true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/admin/clients")
      .then((r) => r.json().catch(() => []))
      .then((rows) => {
        if (Array.isArray(rows)) {
          setClients(rows.map((r: any) => ({ id: r.id, name: r.name, email: r.email })));
        }
      })
      .catch(() => setClients([]));
  }, []);

  const filteredClients = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2">
        <Checkbox
          checked={isNewClient}
          onCheckedChange={(v) => {
            setIsNewClient(v === true);
            onChange({ ...data, isNewClient: v === true });
          }}
        />
        <span className="text-sm">Create a new client (uncheck to link existing)</span>
      </label>

      {isNewClient ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Client name *</Label>
            <Input
              value={String((data as any).clientName ?? "")}
              onChange={(e) => onChange({ ...data, clientName: e.target.value })}
              placeholder="Full name or company"
            />
          </div>
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={String((data as any).clientEmail ?? "")}
              onChange={(e) => onChange({ ...data, clientEmail: e.target.value })}
              placeholder="client@example.com"
            />
          </div>
          <div>
            <Label>Phone</Label>
            <Input
              value={String((data as any).clientPhone ?? "")}
              onChange={(e) => onChange({ ...data, clientPhone: e.target.value })}
              placeholder="04XX XXX XXX"
            />
          </div>
          <div>
            <Label>Address</Label>
            <Input
              value={String((data as any).clientAddress ?? "")}
              onChange={(e) => onChange({ ...data, clientAddress: e.target.value })}
              placeholder="Client address"
            />
          </div>
          <div className="md:col-span-2">
            <Label>Notes</Label>
            <Textarea
              value={String((data as any).clientNotes ?? "")}
              onChange={(e) => onChange({ ...data, clientNotes: e.target.value })}
              placeholder="Any notes about this client"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <Label>Search existing client</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type to search by name or email"
            />
          </div>
          {search && filteredClients.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-md border">
              {filteredClients.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => onChange({ ...data, existingClientId: client.id })}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${
                    data.existingClientId === client.id ? "bg-primary/10 font-medium" : ""
                  }`}
                >
                  {client.name}
                  {client.email && <span className="ml-2 text-xs text-muted-foreground">({String(client.email)})</span>}
                </button>
              ))}
            </div>
          )}
          {typeof data.existingClientId === "string" && data.existingClientId && (
            <p className="text-sm text-green-600">
              Linked to: {clients.find((c) => c.id === data.existingClientId)?.name}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
