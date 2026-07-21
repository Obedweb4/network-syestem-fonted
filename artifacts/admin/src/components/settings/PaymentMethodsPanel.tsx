import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getMpesaSettings, updateMpesaSettings, getSystemInfo } from "@/lib/settings-api";
import { ComingSoon } from "@/components/settings/ComingSoon";

export function PaymentMethodsPanel({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const mpesa = useQuery({ queryKey: ["settings", "mpesa"], queryFn: getMpesaSettings });
  const systemInfo = useQuery({ queryKey: ["settings", "system"], queryFn: getSystemInfo });

  const [accountType, setAccountType] = useState<"PAYBILL" | "TILL">("PAYBILL");
  const [shortcode, setShortcode] = useState("");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  const [passkey, setPasskey] = useState("");
  const [isEnabled, setIsEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!mpesa.data) return;
    setAccountType(mpesa.data.accountType);
    setShortcode(mpesa.data.shortcode ?? "");
    setEnvironment((mpesa.data.environment as "sandbox" | "production") ?? "sandbox");
    setCallbackUrl(mpesa.data.callbackUrl ?? "");
    setIsEnabled(mpesa.data.isEnabled);
  }, [mpesa.data]);

  async function save() {
    setSaving(true);
    const result = await updateMpesaSettings({
      accountType, shortcode: shortcode || undefined, environment, callbackUrl: callbackUrl || undefined,
      consumerKey: consumerKey || undefined, consumerSecret: consumerSecret || undefined, passkey: passkey || undefined,
      isEnabled,
    }).catch((err) => { toast({ title: "Failed to save", description: err instanceof Error ? err.message : String(err), variant: "destructive" }); return null; });
    setSaving(false);
    if (result) {
      toast({ title: "M-PESA settings saved" });
      setConsumerKey(""); setConsumerSecret(""); setPasskey(""); // never keep secrets in the form after a successful save
      qc.invalidateQueries({ queryKey: ["settings", "mpesa"] });
    }
  }

  return (
    <div className="space-y-6">
      <div className="mb-2">
        <h2 className="text-base font-semibold">Payment Methods</h2>
        <p className="text-xs text-muted-foreground mt-0.5">How customers pay for hotspot/PPPoE packages.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm">M-PESA {accountType === "TILL" ? "Till" : "Paybill"}</CardTitle>
          <Badge variant="outline" className={mpesa.data?.isEnabled ? "text-green-700 bg-green-500/10 border-green-200" : "text-muted-foreground"}>
            {mpesa.data?.configured ? (mpesa.data.isEnabled ? "Enabled" : "Configured, disabled") : "Not configured"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {!systemInfo.data?.mpesaEnvVarsConfigured && !mpesa.data?.configured && (
            <p className="text-xs text-muted-foreground flex items-start gap-1.5"><ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />No deployment-wide MPESA_* env vars are set either — until one of these is configured, STK push checkout will return a clear "not configured" error to customers rather than fail silently.</p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Account type</Label>
              <Select value={accountType} onValueChange={(v) => setAccountType(v as "PAYBILL" | "TILL")} disabled={!isAdmin}>
                <SelectTrigger data-testid="select-mpesa-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PAYBILL">Paybill</SelectItem>
                  <SelectItem value="TILL">Till Number</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{accountType === "TILL" ? "Till number" : "Paybill (shortcode)"}</Label>
              <Input value={shortcode} onChange={(e) => setShortcode(e.target.value)} disabled={!isAdmin} data-testid="input-mpesa-shortcode" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Environment</Label>
              <Select value={environment} onValueChange={(v) => setEnvironment(v as "sandbox" | "production")} disabled={!isAdmin}>
                <SelectTrigger data-testid="select-mpesa-env"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="sandbox">Sandbox</SelectItem><SelectItem value="production">Production</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Callback URL (optional override)</Label>
              <Input value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} placeholder="Uses deployment default if blank" disabled={!isAdmin} data-testid="input-mpesa-callback" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Consumer key {mpesa.data?.hasConsumerKey && <span className="text-muted-foreground font-normal">(set)</span>}</Label>
              <Input type="password" value={consumerKey} onChange={(e) => setConsumerKey(e.target.value)} placeholder={mpesa.data?.hasConsumerKey ? "••••••••" : ""} disabled={!isAdmin} data-testid="input-mpesa-consumer-key" />
            </div>
            <div className="space-y-1.5">
              <Label>Consumer secret {mpesa.data?.hasConsumerSecret && <span className="text-muted-foreground font-normal">(set)</span>}</Label>
              <Input type="password" value={consumerSecret} onChange={(e) => setConsumerSecret(e.target.value)} placeholder={mpesa.data?.hasConsumerSecret ? "••••••••" : ""} disabled={!isAdmin} data-testid="input-mpesa-consumer-secret" />
            </div>
            <div className="space-y-1.5">
              <Label>Passkey {mpesa.data?.hasPasskey && <span className="text-muted-foreground font-normal">(set)</span>}</Label>
              <Input type="password" value={passkey} onChange={(e) => setPasskey(e.target.value)} placeholder={mpesa.data?.hasPasskey ? "••••••••" : ""} disabled={!isAdmin} data-testid="input-mpesa-passkey" />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} disabled={!isAdmin} />
            <span className="text-xs">Use this tenant's own M-PESA app instead of the deployment default</span>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save
            </Button>
          )}
          <p className="text-xs text-muted-foreground">There's no "send a test payment" here — an STK push always prompts a real phone and moves real money on completion, so test by running an actual small checkout instead.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Bank Transfer</CardTitle></CardHeader>
        <CardContent><ComingSoon message="Bank transfer as a payment method isn't built yet — no reconciliation flow exists for matching an incoming bank transfer to a subscription the way the M-PESA callback does." /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Future Methods</CardTitle></CardHeader>
        <CardContent><ComingSoon message="Reserved for additional payment providers (card, other mobile money) as they're scoped." /></CardContent>
      </Card>
    </div>
  );
}
