import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListNotificationTemplates, getListNotificationTemplatesQueryKey } from "@workspace/api-client-react";
import { Loader2, Save, Send, ExternalLink, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { getSmsSettings, updateSmsSettings, testSmsSettings } from "@/lib/settings-api";
import { ComingSoon } from "@/components/settings/ComingSoon";

function SmsGatewayTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const sms = useQuery({ queryKey: ["settings", "sms"], queryFn: getSmsSettings });

  const [senderId, setSenderId] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [isEnabled, setIsEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!sms.data) return;
    setSenderId(sms.data.senderId ?? ""); setApiUrl(sms.data.apiUrl ?? ""); setIsEnabled(sms.data.isEnabled);
  }, [sms.data]);

  async function save() {
    setSaving(true);
    const result = await updateSmsSettings({ senderId: senderId || undefined, apiUrl: apiUrl || undefined, apiKey: apiKey || undefined, apiSecret: apiSecret || undefined, isEnabled })
      .catch((err) => { toast({ title: "Failed to save", description: err instanceof Error ? err.message : String(err), variant: "destructive" }); return null; });
    setSaving(false);
    if (result) { toast({ title: "SMS gateway saved" }); setApiKey(""); setApiSecret(""); qc.invalidateQueries({ queryKey: ["settings", "sms"] }); }
  }

  async function sendTest() {
    if (!testPhone.trim()) return;
    setTesting(true);
    const result = await testSmsSettings(testPhone.trim()).catch((err) => ({ success: false, error: err instanceof Error ? err.message : String(err) }));
    setTesting(false);
    toast(result.success ? { title: "Test message sent" } : { title: "Test failed", description: result.error, variant: "destructive" });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">SMS Gateway (Texin)</CardTitle>
        <Badge variant="outline" className={sms.data?.isEnabled ? "text-green-700 bg-green-500/10 border-green-200" : "text-muted-foreground"}>
          {sms.data?.configured ? (sms.data.isEnabled ? "Enabled" : "Configured, disabled") : "Not configured"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5"><Label>Sender ID</Label><Input value={senderId} onChange={(e) => setSenderId(e.target.value)} disabled={!isAdmin} data-testid="input-sms-sender-id" /></div>
          <div className="space-y-1.5"><Label>API URL (optional override)</Label><Input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} disabled={!isAdmin} data-testid="input-sms-api-url" /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5"><Label>API key {sms.data?.hasApiKey && <span className="text-muted-foreground font-normal">(set)</span>}</Label><Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={sms.data?.hasApiKey ? "••••••••" : ""} disabled={!isAdmin} data-testid="input-sms-api-key" /></div>
          <div className="space-y-1.5"><Label>API secret {sms.data?.hasApiSecret && <span className="text-muted-foreground font-normal">(set)</span>}</Label><Input type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder={sms.data?.hasApiSecret ? "••••••••" : ""} disabled={!isAdmin} data-testid="input-sms-api-secret" /></div>
        </div>
        <div className="flex items-center gap-2"><Switch checked={isEnabled} onCheckedChange={setIsEnabled} disabled={!isAdmin} /><span className="text-xs">Use this tenant's own gateway instead of the deployment default</span></div>
        {isAdmin && <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Save</Button>}

        {isAdmin && sms.data?.configured && (
          <div className="pt-2 border-t border-border flex items-end gap-2">
            <div className="space-y-1.5 flex-1"><Label className="text-xs">Send a test SMS</Label><Input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="0712345678" data-testid="input-sms-test-phone" /></div>
            <Button size="sm" variant="outline" onClick={sendTest} disabled={testing || !testPhone.trim()} className="gap-1.5">{testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}Send test</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TemplatesTab() {
  const list = useListNotificationTemplates({ query: { queryKey: getListNotificationTemplatesQueryKey() } });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Message Templates</CardTitle>
        <Link href="/notifications"><Button size="sm" variant="outline" className="gap-1.5"><ExternalLink className="w-3.5 h-3.5" />Manage templates</Button></Link>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">Full template editing (create, edit body/variables, activate/deactivate) lives on the Notifications page — this is just a quick summary.</p>
        <div className="space-y-1.5">
          {list.data?.slice(0, 8).map((t: any) => (
            <div key={t.id} className="flex items-center gap-2 text-xs py-1 border-b border-border last:border-0">
              <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium flex-1">{t.name}</span>
              <Badge variant="outline" className="text-[10px]">{t.channel}</Badge>
              {!t.isActive && <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>}
            </div>
          ))}
          {list.data?.length === 0 && <p className="text-xs text-muted-foreground">No templates yet.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export function NotificationsPanel({ isAdmin }: { isAdmin: boolean }) {
  const [tab, setTab] = useState("sms");
  return (
    <div className="space-y-6">
      <div className="mb-2">
        <h2 className="text-base font-semibold">Notifications</h2>
        <p className="text-xs text-muted-foreground mt-0.5">How and what customers are messaged about their account.</p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="sms">SMS Gateway</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "sms" && <SmsGatewayTab isAdmin={isAdmin} />}
      {tab === "email" && <ComingSoon message="No email provider is wired up yet — the notifications table supports an EMAIL channel, but nothing sends through it today. SMS is the only channel that actually delivers." />}
      {tab === "whatsapp" && <ComingSoon message="Same as Email — WhatsApp is a recognized channel in the data model but has no provider integration yet." />}
      {tab === "templates" && <TemplatesTab />}
    </div>
  );
}
